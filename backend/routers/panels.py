"""Panel Configs — CRUD for report panel theme overlays.

Panels (VAS, Method, etc.) are thin JSON config overlays that sit on top of
the base report template. Switching panels is like switching light/dark mode —
the data stays the same, only the presentation and requirements change.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .auth import get_current_user, get_user_supabase
from .rate_limit import limiter
from services.panel_service import merge_panel_with_template, evaluate_reminders

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/panels", tags=["panels"])


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------
class PanelCreate(BaseModel):
    slug: str
    name: str
    description: Optional[str] = None
    config: dict = {}


class PanelUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    config: Optional[dict] = None
    is_active: Optional[bool] = None


class ReminderRequest(BaseModel):
    panel_slug: str
    current_state: dict  # { comparables_count, fields: {}, comparables_ranked }


# ---------------------------------------------------------------------------
# GET /api/panels — list all active panels
# ---------------------------------------------------------------------------
@router.get("")
@limiter.limit("60/minute")
async def list_panels(request: Request, user=Depends(get_current_user)):
    sb = get_user_supabase(user)
    resp = (
        sb.table("panel_configs")
        .select("id, slug, name, description, config, is_active, created_at")
        .eq("is_active", True)
        .order("name")
        .execute()
    )
    return resp.data or []


# ---------------------------------------------------------------------------
# GET /api/panels/{slug} — get a single panel config
# ---------------------------------------------------------------------------
@router.get("/{slug}")
@limiter.limit("60/minute")
async def get_panel(request: Request, slug: str, user=Depends(get_current_user)):
    sb = get_user_supabase(user)
    resp = (
        sb.table("panel_configs")
        .select("*")
        .eq("slug", slug)
        .execute()
    )
    if not resp.data:
        raise HTTPException(404, f"Panel '{slug}' not found")
    return resp.data[0]


# ---------------------------------------------------------------------------
# POST /api/panels — create a new panel config (admin only)
# ---------------------------------------------------------------------------
@router.post("")
@limiter.limit("10/minute")
async def create_panel(request: Request, body: PanelCreate, user=Depends(get_current_user)):
    sb = get_user_supabase(user)

    row = {
        "slug": body.slug,
        "name": body.name,
        "description": body.description,
        "config": body.config,
    }
    try:
        resp = sb.table("panel_configs").insert(row).execute()
    except Exception as exc:
        if "duplicate" in str(exc).lower() or "unique" in str(exc).lower():
            raise HTTPException(409, f"Panel with slug '{body.slug}' already exists")
        raise
    if resp.data:
        return resp.data[0]
    raise HTTPException(500, "Failed to create panel")


# ---------------------------------------------------------------------------
# PUT /api/panels/{slug} — update a panel config (admin only)
# ---------------------------------------------------------------------------
@router.put("/{slug}")
@limiter.limit("20/minute")
async def update_panel(request: Request, slug: str, body: PanelUpdate, user=Depends(get_current_user)):
    sb = get_user_supabase(user)

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")

    resp = (
        sb.table("panel_configs")
        .update(updates)
        .eq("slug", slug)
        .execute()
    )
    if resp.data:
        return resp.data[0]
    raise HTTPException(404, f"Panel '{slug}' not found")


# ---------------------------------------------------------------------------
# GET /api/panels/{slug}/preview-schema — preview merged base template + panel
# ---------------------------------------------------------------------------
@router.get("/{slug}/preview-schema")
@limiter.limit("30/minute")
async def preview_panel_schema(
    request: Request,
    slug: str,
    template_id: str = None,
    user=Depends(get_current_user),
):
    """Preview what the merged template schema looks like with this panel applied.

    If template_id is provided, merges with that template. Otherwise uses the
    system default template.
    """
    sb = get_user_supabase(user)

    # Fetch panel config
    panel_resp = (
        sb.table("panel_configs")
        .select("config")
        .eq("slug", slug)
        .execute()
    )
    if not panel_resp.data:
        raise HTTPException(404, f"Panel '{slug}' not found")

    panel_config = panel_resp.data[0]["config"]

    # Fetch base template
    if template_id:
        tmpl_resp = (
            sb.table("report_templates")
            .select("schema")
            .eq("id", template_id)
            .execute()
        )
    else:
        tmpl_resp = (
            sb.table("report_templates")
            .select("schema")
            .eq("source", "system")
            .eq("is_default", True)
            .limit(1)
            .execute()
        )
    if not tmpl_resp.data:
        raise HTTPException(404, "Base template not found")

    template_schema = tmpl_resp.data[0]["schema"]

    # Handle JSON string
    if isinstance(template_schema, str):
        import json
        try:
            template_schema = json.loads(template_schema)
        except json.JSONDecodeError:
            raise HTTPException(422, "Template has an invalid schema")

    merged = merge_panel_with_template(template_schema, panel_config)
    return {
        "panel_slug": slug,
        "merged_schema": merged,
        "section_count": len(merged.get("sections", [])),
    }


# ---------------------------------------------------------------------------
# POST /api/panels/reminders — evaluate inline reminders for active panel
# ---------------------------------------------------------------------------
@router.post("/reminders")
@limiter.limit("30/minute")
async def check_reminders(request: Request, body: ReminderRequest, user=Depends(get_current_user)):
    """Evaluate panel inline reminders against current report state.

    Returns active reminders (those whose conditions are triggered).
    """
    sb = get_user_supabase(user)

    resp = (
        sb.table("panel_configs")
        .select("config")
        .eq("slug", body.panel_slug)
        .execute()
    )
    if not resp.data:
        raise HTTPException(404, f"Panel '{body.panel_slug}' not found")

    panel_config = resp.data[0]["config"]
    active_reminders = evaluate_reminders(panel_config, body.current_state)
    return {"reminders": active_reminders}
