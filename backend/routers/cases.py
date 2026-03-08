"""Save / list / retrieve / delete property cases.

Phase 1 architecture: cases reference a UPRN (property library) and carry
a system-generated display_name, case_type, and status. Cases stack under
a UPRN — multiple cases per property are expected.
"""

import os
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import create_client

from .auth import get_current_user

router = APIRouter(prefix="/api/cases", tags=["cases"])

# Phase 1 allowed values
CASE_TYPES = ("research", "full_valuation")
CASE_STATUSES = ("draft", "in_progress", "complete", "archived")

# ---------------------------------------------------------------------------
# Supabase client (lazy, service-role)
# ---------------------------------------------------------------------------
_supabase = None


def _sb():
    global _supabase
    if _supabase is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise HTTPException(500, "Supabase not configured")
        _supabase = create_client(url, key)
    return _supabase


def _generate_display_name(address: str, case_type: str) -> str:
    """Generate a system display name: 'address — CaseType — YYYY-MM-DD'."""
    type_label = case_type.replace("_", " ").title()
    today = datetime.utcnow().strftime("%Y-%m-%d")
    return f"{address} — {type_label} — {today}"


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------
class SaveCaseRequest(BaseModel):
    address: str
    postcode: str | None = None
    uprn: str | None = None
    case_type: str = "research"
    property_data: dict | None = None
    comparables: list = []
    valuation_date: str | None = None
    hpi_correlation: float = 100
    size_elasticity: float = 0
    notes: str | None = None


class UpdateCaseRequest(BaseModel):
    status: str | None = None
    comparables: list | None = None
    valuation_date: str | None = None
    hpi_correlation: float | None = None
    size_elasticity: float | None = None
    notes: str | None = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.post("")
async def save_case(body: SaveCaseRequest, user: dict = Depends(get_current_user)):
    """Create a new case. Display name is system-generated."""
    if body.case_type not in CASE_TYPES:
        raise HTTPException(400, f"Invalid case_type. Allowed: {CASE_TYPES}")

    display_name = _generate_display_name(body.address, body.case_type)

    row = {
        "surveyor_id": user["id"],
        "title": display_name,  # legacy column, kept for backward compat
        "display_name": display_name,
        "case_type": body.case_type,
        "status": "draft",
        "address": body.address,
        "postcode": body.postcode,
        "uprn": body.uprn,
        "property_data": body.property_data,
        "property_snapshot": body.property_data,
        "comparables": body.comparables,
        "valuation_date": body.valuation_date,
        "hpi_correlation": body.hpi_correlation,
        "size_elasticity": body.size_elasticity,
        "notes": body.notes,
    }
    resp = _sb().table("cases").insert(row).execute()
    return resp.data[0]


@router.get("")
async def list_cases(user: dict = Depends(get_current_user)):
    """List all cases for the current user (summary only)."""
    resp = (
        _sb()
        .table("cases")
        .select(
            "id, display_name, title, address, postcode, uprn, "
            "case_type, status, created_at, updated_at"
        )
        .eq("surveyor_id", user["id"])
        .order("updated_at", desc=True)
        .execute()
    )
    return {"cases": resp.data}


@router.get("/{case_id}")
async def get_case(case_id: str, user: dict = Depends(get_current_user)):
    """Retrieve a full saved case."""
    resp = (
        _sb()
        .table("cases")
        .select("*")
        .eq("id", case_id)
        .eq("surveyor_id", user["id"])
        .execute()
    )
    if not resp.data:
        raise HTTPException(404, "Case not found")
    return resp.data[0]


@router.patch("/{case_id}")
async def update_case(
    case_id: str, body: UpdateCaseRequest, user: dict = Depends(get_current_user)
):
    """Update a saved case (status, comparables, valuation params, notes)."""
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "Nothing to update")

    if "status" in updates and updates["status"] not in CASE_STATUSES:
        raise HTTPException(400, f"Invalid status. Allowed: {CASE_STATUSES}")

    updates["updated_at"] = "now()"
    resp = (
        _sb()
        .table("cases")
        .update(updates)
        .eq("id", case_id)
        .eq("surveyor_id", user["id"])
        .execute()
    )
    if not resp.data:
        raise HTTPException(404, "Case not found")
    return resp.data[0]


@router.delete("/{case_id}")
async def delete_case(case_id: str, user: dict = Depends(get_current_user)):
    """Delete a saved case."""
    resp = (
        _sb()
        .table("cases")
        .delete()
        .eq("id", case_id)
        .eq("surveyor_id", user["id"])
        .execute()
    )
    if not resp.data:
        raise HTTPException(404, "Case not found")
    return {"deleted": True}
