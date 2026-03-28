"""Firm signatory registry — staff details for RICS report signing.

Phase 1: keyed by surveyor_id (same pattern as firm_templates).
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .auth import get_current_user, get_user_supabase
from .rate_limit import limiter

router = APIRouter(prefix="/api/firm-signatories", tags=["firm-signatories"])


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class SignatoryCreate(BaseModel):
    full_name: str
    rics_number: str = ""
    qualifications: str = ""
    role_title: str = ""
    email: str = ""
    phone: str = ""
    can_prepare: bool = True
    can_countersign: bool = False


class SignatoryUpdate(BaseModel):
    full_name: str | None = None
    rics_number: str | None = None
    qualifications: str | None = None
    role_title: str | None = None
    email: str | None = None
    phone: str | None = None
    can_prepare: bool | None = None
    can_countersign: bool | None = None


# ---------------------------------------------------------------------------
# GET — list all active signatories for this surveyor
# ---------------------------------------------------------------------------
@router.get("")
@limiter.limit("60/minute")
async def list_signatories(request: Request, user=Depends(get_current_user)):
    uid = user["id"]
    sb = get_user_supabase(user)
    resp = (
        sb.table("firm_signatories")
        .select("*")
        .eq("surveyor_id", uid)
        .eq("is_active", True)
        .order("full_name")
        .execute()
    )
    return resp.data or []


# ---------------------------------------------------------------------------
# POST — create a new signatory
# ---------------------------------------------------------------------------
@router.post("")
@limiter.limit("10/minute")
async def create_signatory(
    request: Request,
    body: SignatoryCreate,
    user=Depends(get_current_user),
):
    uid = user["id"]
    sb = get_user_supabase(user)
    row = body.model_dump()
    row["surveyor_id"] = uid
    resp = sb.table("firm_signatories").insert(row).execute()
    if resp.data:
        return resp.data[0]
    raise HTTPException(500, "Failed to create signatory")


# ---------------------------------------------------------------------------
# PUT — update an existing signatory
# ---------------------------------------------------------------------------
@router.put("/{signatory_id}")
@limiter.limit("20/minute")
async def update_signatory(
    request: Request,
    signatory_id: str,
    body: SignatoryUpdate,
    user=Depends(get_current_user),
):
    uid = user["id"]
    sb = get_user_supabase(user)
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")
    resp = (
        sb.table("firm_signatories")
        .update(updates)
        .eq("id", signatory_id)
        .eq("surveyor_id", uid)
        .execute()
    )
    if resp.data:
        return resp.data[0]
    raise HTTPException(404, "Signatory not found")


# ---------------------------------------------------------------------------
# DELETE — soft-delete a signatory
# ---------------------------------------------------------------------------
@router.delete("/{signatory_id}")
@limiter.limit("10/minute")
async def delete_signatory(
    request: Request,
    signatory_id: str,
    user=Depends(get_current_user),
):
    uid = user["id"]
    sb = get_user_supabase(user)
    resp = (
        sb.table("firm_signatories")
        .update({"is_active": False})
        .eq("id", signatory_id)
        .eq("surveyor_id", uid)
        .execute()
    )
    if resp.data:
        return {"ok": True}
    raise HTTPException(404, "Signatory not found")
