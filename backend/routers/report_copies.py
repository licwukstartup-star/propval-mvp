"""Report Copies — immutable versioned snapshots of editor output.

Each copy captures the TipTap editor HTML + wizard state at a point in time.
Content is immutable after creation; only label and status can be updated.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from .auth import get_current_user, get_user_supabase
from .rate_limit import limiter
from services.pdf_service import html_to_pdf

router = APIRouter(prefix="/api", tags=["report_copies"])
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------
class CreateCopyRequest(BaseModel):
    editor_html: str
    editor_json: Optional[dict] = None
    wizard_snapshot: Optional[dict] = None
    label: Optional[str] = None


class UpdateCopyRequest(BaseModel):
    label: Optional[str] = None
    status: Optional[str] = None


COPY_STATUSES = ("draft", "ready_for_review", "under_review", "revision_requested", "approved", "final")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _next_version(sb, case_id: str) -> int:
    """Get the next version number for a case's copies."""
    resp = (
        sb.table("report_copies")
        .select("version")
        .eq("case_id", case_id)
        .order("version", desc=True)
        .limit(1)
        .execute()
    )
    if resp.data and resp.data[0].get("version"):
        return resp.data[0]["version"] + 1
    return 1


def _insert_copy_with_retry(sb, row: dict, case_id: str, max_retries: int = 3) -> dict:
    """Insert a report copy with retry on version conflict (unique constraint)."""
    for attempt in range(max_retries):
        try:
            resp = sb.table("report_copies").insert(row).execute()
            if resp.data:
                return resp.data[0]
        except Exception as exc:
            if "uq_report_copy_case_version" in str(exc) or "duplicate" in str(exc).lower():
                # Version conflict — recalculate
                row["version"] = _next_version(sb, case_id)
                row["label"] = row.get("_auto_label", row["label"])
                if row.get("_auto_label"):
                    row["label"] = f"Draft {row['version']}"
                continue
            raise
    raise HTTPException(500, "Failed to save copy after retries — please try again")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.post("/cases/{case_id}/copies")
@limiter.limit("30/minute")
async def create_copy(
    request: Request,
    case_id: str,
    body: CreateCopyRequest,
    user: dict = Depends(get_current_user),
):
    """Save a new immutable report copy."""
    if not body.editor_html.strip():
        raise HTTPException(400, "editor_html cannot be empty")

    sb = get_user_supabase(user)

    # Verify case exists and belongs to user (or firm)
    case_check = (
        sb.table("cases")
        .select("id, status")
        .eq("id", case_id)
        .execute()
    )
    if not case_check.data:
        raise HTTPException(404, "Case not found")

    version = _next_version(sb, case_id)
    label = body.label or f"Draft {version}"

    row = {
        "case_id": case_id,
        "version": version,
        "label": label,
        "_auto_label": not body.label,  # track if label was auto-generated
        "status": "draft",
        "editor_html": body.editor_html,
        "editor_json": body.editor_json,
        "wizard_snapshot": body.wizard_snapshot,
        "created_by": user["id"],
    }
    del row["_auto_label"]

    result = _insert_copy_with_retry(sb, row, case_id)
    logger.info("Report copy created: case=%s version=%d label=%s", case_id, result["version"], result["label"])
    return result


@router.get("/cases/{case_id}/copies")
@limiter.limit("60/minute")
async def list_copies(
    request: Request,
    case_id: str,
    user: dict = Depends(get_current_user),
):
    """List all copies for a case (summary only, no HTML body)."""
    sb = get_user_supabase(user)
    resp = (
        sb.table("report_copies")
        .select("id, case_id, version, label, status, created_by, created_at")
        .eq("case_id", case_id)
        .order("version", desc=True)
        .execute()
    )
    return {"copies": resp.data}


@router.get("/copies/{copy_id}")
@limiter.limit("60/minute")
async def get_copy(
    request: Request,
    copy_id: str,
    user: dict = Depends(get_current_user),
):
    """Get a single copy with full HTML content."""
    sb = get_user_supabase(user)
    resp = (
        sb.table("report_copies")
        .select("*")
        .eq("id", copy_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(404, "Copy not found")
    return resp.data[0]


@router.patch("/copies/{copy_id}")
@limiter.limit("30/minute")
async def update_copy(
    request: Request,
    copy_id: str,
    body: UpdateCopyRequest,
    user: dict = Depends(get_current_user),
):
    """Update label or status of a copy. Content is immutable."""
    sb = get_user_supabase(user)

    # Verify ownership
    current = (
        sb.table("report_copies")
        .select("id, status, created_by")
        .eq("id", copy_id)
        .execute()
    )
    if not current.data:
        raise HTTPException(404, "Copy not found")

    copy = current.data[0]
    if copy["created_by"] != user["id"]:
        raise HTTPException(403, "You can only update your own copies")

    # Final copies are immutable
    if copy["status"] == "final":
        raise HTTPException(403, "Final copies cannot be modified")

    updates: dict = {}
    if body.label is not None:
        updates["label"] = body.label
    if body.status is not None:
        if body.status not in COPY_STATUSES:
            raise HTTPException(400, f"Invalid status. Allowed: {COPY_STATUSES}")
        updates["status"] = body.status

    if not updates:
        raise HTTPException(400, "Nothing to update")

    resp = (
        sb.table("report_copies")
        .update(updates)
        .eq("id", copy_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(500, "Failed to update copy")
    return resp.data[0]


@router.delete("/copies/{copy_id}")
@limiter.limit("10/minute")
async def delete_copy(
    request: Request,
    copy_id: str,
    user: dict = Depends(get_current_user),
):
    """Delete a draft copy. Non-draft copies cannot be deleted."""
    sb = get_user_supabase(user)

    current = (
        sb.table("report_copies")
        .select("id, status, created_by")
        .eq("id", copy_id)
        .execute()
    )
    if not current.data:
        raise HTTPException(404, "Copy not found")

    copy = current.data[0]
    if copy["created_by"] != user["id"]:
        raise HTTPException(403, "You can only delete your own copies")
    if copy["status"] != "draft":
        raise HTTPException(403, "Only draft copies can be deleted")

    resp = (
        sb.table("report_copies")
        .delete()
        .eq("id", copy_id)
        .execute()
    )
    return {"deleted": True}


@router.get("/copies/{copy_id}/pdf")
@limiter.limit("10/minute")
async def get_copy_pdf(
    request: Request,
    copy_id: str,
    user: dict = Depends(get_current_user),
):
    """Generate and return a PDF of a report copy."""
    sb = get_user_supabase(user)
    resp = (
        sb.table("report_copies")
        .select("editor_html, label, version")
        .eq("id", copy_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(404, "Copy not found")

    copy = resp.data[0]
    try:
        pdf_bytes = await html_to_pdf(copy["editor_html"])
    except Exception as exc:
        logger.error("PDF generation failed for copy %s: %s", copy_id, exc)
        raise HTTPException(500, "PDF generation failed")

    # Sanitize label for Content-Disposition header
    import re
    safe_label = re.sub(r'[^\w\s\-\.]', '', copy['label'])[:100]
    filename = f"Report - {safe_label} v{copy['version']}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
