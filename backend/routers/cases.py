"""Save / list / retrieve / delete property cases."""

import os
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import create_client

from .auth import get_current_user

router = APIRouter(prefix="/api/cases", tags=["cases"])

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


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------
class SaveCaseRequest(BaseModel):
    title: str
    address: str
    postcode: str | None = None
    uprn: str | None = None
    property_data: dict
    comparables: list = []
    valuation_date: str | None = None
    hpi_correlation: float = 100
    size_elasticity: float = 0


class UpdateCaseRequest(BaseModel):
    title: str | None = None
    comparables: list | None = None
    valuation_date: str | None = None
    hpi_correlation: float | None = None
    size_elasticity: float | None = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.post("")
async def save_case(body: SaveCaseRequest, user: dict = Depends(get_current_user)):
    """Create a new saved case."""
    row = {
        "surveyor_id": user["id"],
        "title": body.title.strip(),
        "address": body.address,
        "postcode": body.postcode,
        "uprn": body.uprn,
        "property_data": body.property_data,
        "comparables": body.comparables,
        "valuation_date": body.valuation_date,
        "hpi_correlation": body.hpi_correlation,
        "size_elasticity": body.size_elasticity,
    }
    resp = _sb().table("cases").insert(row).execute()
    return resp.data[0]


@router.get("")
async def list_cases(user: dict = Depends(get_current_user)):
    """List all cases for the current user (summary only)."""
    resp = (
        _sb()
        .table("cases")
        .select("id, title, address, postcode, uprn, created_at, updated_at")
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
    """Update a saved case (title, comparables, valuation params)."""
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "Nothing to update")
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
