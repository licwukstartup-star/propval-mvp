"""QA endpoints — run AI quality checks on report copies."""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .auth import get_current_user, get_user_supabase
from .rate_limit import limiter
from services.qa_service import run_qa_checks

router = APIRouter(prefix="/api/qa", tags=["qa"])
logger = logging.getLogger(__name__)


class RunQARequest(BaseModel):
    copy_id: str
    structured_data: Optional[dict] = None  # property + valuer + meta + comparables + semv
    panel_slug: Optional[str] = None  # Panel theme for panel-specific QA rules


@router.post("/run")
@limiter.limit("10/minute")
async def run_qa(
    request: Request,
    body: RunQARequest,
    user: dict = Depends(get_current_user),
):
    """Run AI QA checks on a report copy and persist results."""
    sb = get_user_supabase(user)

    # Fetch the copy
    copy_resp = (
        sb.table("report_copies")
        .select("id, editor_html, wizard_snapshot, case_id")
        .eq("id", body.copy_id)
        .execute()
    )
    if not copy_resp.data:
        raise HTTPException(404, "Copy not found")

    copy = copy_resp.data[0]

    # Build structured data from wizard_snapshot + any extra passed from frontend
    structured = body.structured_data or {}
    ws = copy.get("wizard_snapshot") or {}
    if "meta" not in structured and "meta" in ws:
        structured["meta"] = ws["meta"]
    if "valuer" not in structured and "valuer" in ws:
        structured["valuer"] = ws["valuer"]

    # Fetch case property data if not provided
    if "property" not in structured:
        case_resp = (
            sb.table("cases")
            .select("property_snapshot, comparables")
            .eq("id", copy["case_id"])
            .execute()
        )
        if case_resp.data:
            case = case_resp.data[0]
            if case.get("property_snapshot"):
                structured["property"] = case["property_snapshot"]
            if case.get("comparables") and "comparables" not in structured:
                structured["comparables"] = case["comparables"]

    # Fetch panel QA rules if panel_slug provided
    panel_qa_rules = None
    if body.panel_slug:
        panel_resp = (
            sb.table("panel_configs")
            .select("config")
            .eq("slug", body.panel_slug)
            .eq("is_active", True)
            .execute()
        )
        if panel_resp.data:
            from services.panel_service import get_panel_qa_rules
            panel_qa_rules = get_panel_qa_rules(panel_resp.data[0]["config"])

    # Run AI QA
    findings, model_used = await run_qa_checks(
        editor_html=copy["editor_html"],
        structured_data=structured,
        user_id=user.get("id"),
        user_email=user.get("email"),
        panel_qa_rules=panel_qa_rules,
    )

    # Persist results
    row = {
        "copy_id": body.copy_id,
        "run_by": user["id"],
        "findings": findings,
        "model_used": model_used,
    }
    save_resp = sb.table("qa_results").insert(row).execute()

    return {
        "findings": findings,
        "model_used": model_used,
        "qa_result_id": save_resp.data[0]["id"] if save_resp.data else None,
    }


@router.get("/results/{copy_id}")
@limiter.limit("60/minute")
async def get_qa_results(
    request: Request,
    copy_id: str,
    user: dict = Depends(get_current_user),
):
    """Get the most recent QA results for a copy."""
    sb = get_user_supabase(user)
    resp = (
        sb.table("qa_results")
        .select("id, copy_id, findings, model_used, created_at")
        .eq("copy_id", copy_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if not resp.data:
        return {"qa_result": None}
    return {"qa_result": resp.data[0]}
