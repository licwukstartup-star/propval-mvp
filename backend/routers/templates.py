"""Report template CRUD — ARTG (Adaptive Report Template Generator).

Manages report templates: system gallery, user-uploaded (.docx parsed by AI),
and custom-built templates. Each template stores a JSON schema that defines
sections, branding, and layout for report generation.
"""

import logging
import os
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from .auth import get_current_user, get_user_supabase
from services.template_service import parse_docx_structure, classify_sections_with_ai
from services.report_generator import generate_report_docx

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/templates", tags=["templates"])


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class TemplateCreate(BaseModel):
    name: str
    description: Optional[str] = None
    source: str = "custom"  # "system" | "uploaded" | "custom"
    schema_data: dict = {}  # the template JSON schema
    is_default: bool = False


class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    schema_data: Optional[dict] = None
    is_default: Optional[bool] = None


# ---------------------------------------------------------------------------
# GET /api/templates — list user's templates + system templates
# ---------------------------------------------------------------------------
@router.get("")
async def list_templates(user=Depends(get_current_user)):
    uid = user["id"]
    sb = get_user_supabase(user)

    # Fetch system templates + user's own templates
    # RLS handles filtering, but we query both explicitly for clarity
    resp = (
        sb.table("report_templates")
        .select("id, name, description, source, is_default, thumbnail, created_at, updated_at")
        .or_(f"source.eq.system,created_by.eq.{uid}")
        .order("created_at", desc=False)
        .execute()
    )
    return resp.data or []


# ---------------------------------------------------------------------------
# GET /api/templates/gallery — system templates only
# ---------------------------------------------------------------------------
@router.get("/gallery")
async def list_gallery(user=Depends(get_current_user)):
    sb = get_user_supabase(user)
    resp = (
        sb.table("report_templates")
        .select("id, name, description, schema, is_default, thumbnail")
        .eq("source", "system")
        .order("created_at", desc=False)
        .execute()
    )
    return resp.data or []


# ---------------------------------------------------------------------------
# GET /api/templates/{template_id} — get full template with schema
# ---------------------------------------------------------------------------
@router.get("/{template_id}")
async def get_template(template_id: UUID, user=Depends(get_current_user)):
    sb = get_user_supabase(user)
    resp = (
        sb.table("report_templates")
        .select("*")
        .eq("id", str(template_id))
        .execute()
    )
    if not resp.data:
        raise HTTPException(404, "Template not found")
    return resp.data[0]


# ---------------------------------------------------------------------------
# POST /api/templates — create a new template
# ---------------------------------------------------------------------------
@router.post("")
async def create_template(body: TemplateCreate, user=Depends(get_current_user)):
    uid = user["id"]
    sb = get_user_supabase(user)

    # Users cannot create system templates
    source = body.source if body.source != "system" else "custom"

    row = {
        "created_by": uid,
        "name": body.name,
        "description": body.description,
        "source": source,
        "schema": body.schema_data,
        "is_default": body.is_default,
    }

    resp = sb.table("report_templates").insert(row).execute()
    if resp.data:
        return resp.data[0]
    raise HTTPException(500, "Failed to create template")


# ---------------------------------------------------------------------------
# PUT /api/templates/{template_id} — update a template
# ---------------------------------------------------------------------------
@router.put("/{template_id}")
async def update_template(
    template_id: UUID,
    body: TemplateUpdate,
    user=Depends(get_current_user),
):
    uid = user["id"]
    sb = get_user_supabase(user)

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    # Rename schema_data -> schema for the DB column
    if "schema_data" in updates:
        updates["schema"] = updates.pop("schema_data")
    if not updates:
        raise HTTPException(400, "No fields to update")

    resp = (
        sb.table("report_templates")
        .update(updates)
        .eq("id", str(template_id))
        .eq("created_by", uid)
        .execute()
    )
    if resp.data:
        return resp.data[0]
    raise HTTPException(404, "Template not found or not owned by you")


# ---------------------------------------------------------------------------
# DELETE /api/templates/{template_id} — delete a template
# ---------------------------------------------------------------------------
@router.delete("/{template_id}")
async def delete_template(template_id: UUID, user=Depends(get_current_user)):
    uid = user["id"]
    sb = get_user_supabase(user)

    resp = (
        sb.table("report_templates")
        .delete()
        .eq("id", str(template_id))
        .eq("created_by", uid)
        .execute()
    )
    if resp.data:
        return {"deleted": True}
    raise HTTPException(404, "Template not found or not owned by you")


# ---------------------------------------------------------------------------
# POST /api/templates/{template_id}/clone — clone a template for editing
# ---------------------------------------------------------------------------
@router.post("/{template_id}/clone")
async def clone_template(template_id: UUID, user=Depends(get_current_user)):
    uid = user["id"]
    sb = get_user_supabase(user)

    # Fetch source template
    resp = (
        sb.table("report_templates")
        .select("name, description, schema")
        .eq("id", str(template_id))
        .execute()
    )
    if not resp.data:
        raise HTTPException(404, "Template not found")

    original = resp.data[0]
    row = {
        "created_by": uid,
        "name": f"{original['name']} (Copy)",
        "description": original.get("description", ""),
        "source": "custom",
        "schema": original["schema"],
        "is_default": False,
    }

    clone_resp = sb.table("report_templates").insert(row).execute()
    if clone_resp.data:
        return clone_resp.data[0]
    raise HTTPException(500, "Failed to clone template")


# ---------------------------------------------------------------------------
# POST /api/templates/upload — parse uploaded .docx and classify with AI
# ---------------------------------------------------------------------------
@router.post("/upload")
async def upload_and_parse_template(
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    """Accept a .docx file, extract structure, classify sections with AI.

    Returns a draft template schema with classifications and confidence scores.
    The user reviews and confirms before saving.
    """
    if not file.filename or not file.filename.lower().endswith(".docx"):
        raise HTTPException(400, "Only .docx files are supported")

    # Check file size before reading (Content-Length header, if available)
    if file.size and file.size > 10 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 10MB)")

    # Read file bytes with a hard cap
    file_bytes = await file.read(10 * 1024 * 1024 + 1)
    if len(file_bytes) > 10 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 10MB)")

    try:
        # Step 1: Parse .docx structure
        parsed = await parse_docx_structure(file_bytes)

        if not parsed.get("sections"):
            raise HTTPException(
                422,
                "Could not detect any sections in the document. "
                "Ensure your report uses heading styles (Heading 1, Heading 2, etc.) "
                "or bold text for section titles."
            )

        # Step 2: Classify sections with AI (falls back to rule-based if no API key)
        result = await classify_sections_with_ai(parsed)

        return {
            "parsed_sections": len(parsed.get("sections", [])),
            "schema": result["schema"],
            "classifications": result["classifications"],
            "metadata": result["metadata"],
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Template upload failed: %s", exc, exc_info=True)
        raise HTTPException(500, f"Failed to parse template: {str(exc)}")


# ---------------------------------------------------------------------------
# POST /api/templates/save-uploaded — save an AI-parsed template after review
# ---------------------------------------------------------------------------
@router.post("/save-uploaded")
async def save_uploaded_template(
    body: TemplateCreate,
    user=Depends(get_current_user),
):
    """Save a template that was created from an uploaded .docx after user review."""
    uid = user["id"]
    sb = get_user_supabase(user)

    row = {
        "created_by": uid,
        "name": body.name,
        "description": body.description,
        "source": "uploaded",
        "schema": body.schema_data,
        "is_default": body.is_default,
    }

    resp = sb.table("report_templates").insert(row).execute()
    if resp.data:
        return resp.data[0]
    raise HTTPException(500, "Failed to save template")


# ---------------------------------------------------------------------------
# POST /api/templates/generate-report — content + template → .docx
# ---------------------------------------------------------------------------
class ReportGenerateRequest(BaseModel):
    template_id: str
    content: dict  # { metadata, valuer_inputs, ai_sections, comparables, property, firm_template }


@router.post("/generate-report")
async def generate_report(
    body: ReportGenerateRequest,
    user=Depends(get_current_user),
):
    """Generate a .docx report by merging content with a template schema."""
    sb = get_user_supabase(user)

    # Fetch template schema
    resp = (
        sb.table("report_templates")
        .select("schema")
        .eq("id", body.template_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(404, "Template not found")

    template_schema = resp.data[0]["schema"]

    # Handle schema stored as string (JSON)
    if isinstance(template_schema, str):
        import json
        try:
            template_schema = json.loads(template_schema)
        except json.JSONDecodeError:
            raise HTTPException(422, "Template has an invalid schema")

    if not template_schema or not template_schema.get("sections"):
        raise HTTPException(422, "Template has no sections defined. Edit the template in the Templates tab first.")

    try:
        docx_path = generate_report_docx(body.content, template_schema)
        return FileResponse(
            docx_path,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            filename="PropVal_Report.docx",
            background=BackgroundTask(os.unlink, docx_path),
        )
    except Exception as exc:
        logger.error("Report generation failed: %s", exc, exc_info=True)
        raise HTTPException(500, f"Failed to generate report: {str(exc)}")
