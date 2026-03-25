"""Save / list / retrieve / delete property cases.

Phase 1 architecture: cases reference a UPRN (property library) and carry
a system-generated display_name, case_type, and status. Cases stack under
a UPRN — multiple cases per property are expected.

Status flow (enforced):
  Research:        draft → in_progress → complete → issued → archived
  Full Valuation:  draft → in_progress → complete → issued → archived
  (back to draft allowed from in_progress only — for rework)
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .auth import get_current_user, get_user_supabase
from .rate_limit import limiter

router = APIRouter(prefix="/api/cases", tags=["cases"])

# Phase 1 allowed values
CASE_TYPES = ("research", "full_valuation")
CASE_STATUSES = ("draft", "in_progress", "complete", "issued", "archived")

# Status flow: maps current status → allowed next statuses
STATUS_FLOW: dict[str, list[str]] = {
    "draft":       ["in_progress"],
    "in_progress": ["draft", "complete"],       # back to draft = rework
    "complete":    ["in_progress", "issued"],  # back to in_progress = rework
    "issued":      ["archived"],                # issued is immutable for edits
    "archived":    [],                          # terminal
}

# ---------------------------------------------------------------------------
# Supabase client — user-scoped (RLS enforced via anon key + user JWT)
# ---------------------------------------------------------------------------


def _generate_display_name(
    address: str,
    case_type: str,
    valuation_basis: str | None = None,
    valuation_date: str | None = None,
) -> str:
    """System-generated case name per architecture spec.

    Format: [Address] | [Case Type] | [Valuation Basis] | [Valuation Date]
    """
    type_label = case_type.replace("_", " ").title()
    parts = [address, type_label]
    if valuation_basis:
        parts.append(valuation_basis.replace("_", " ").title())
    parts.append(valuation_date or datetime.utcnow().strftime("%Y-%m-%d"))
    return " | ".join(parts)


def _next_case_sequence(sb, uprn: str | None) -> int:
    """Get the next case_sequence number for a UPRN."""
    if not uprn:
        return 1
    resp = (
        sb.table("cases")
        .select("case_sequence")
        .eq("uprn", uprn)
        .order("case_sequence", desc=True)
        .limit(1)
        .execute()
    )
    if resp.data and resp.data[0].get("case_sequence"):
        return resp.data[0]["case_sequence"] + 1
    return 1


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------
class SaveCaseRequest(BaseModel):
    address: str
    postcode: str | None = None
    uprn: str | None = None
    case_type: str = "research"
    valuation_basis: str | None = None
    property_data: dict | None = None
    comparables: list = []
    search_results: dict | None = None
    valuation_date: str | None = None
    hpi_correlation: float = 100
    size_elasticity: float = 0
    notes: str | None = None
    firm_reference: str | None = None
    ai_narrative: dict | None = None
    report_content: dict | None = None
    ui_state: dict | None = None


class UpdateCaseRequest(BaseModel):
    status: str | None = None
    comparables: list | None = None
    search_results: dict | None = None
    property_data: dict | None = None      # allow updating snapshot (e.g. manual overrides for no-EPC)
    valuation_date: str | None = None
    valuation_basis: str | None = None
    hpi_correlation: float | None = None
    size_elasticity: float | None = None
    notes: str | None = None
    firm_reference: str | None = None
    ai_narrative: dict | None = None
    report_content: dict | None = None
    ui_state: dict | None = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.post("")
@limiter.limit("30/minute")
async def save_case(request: Request, body: SaveCaseRequest, user: dict = Depends(get_current_user)):
    """Create a new case. Display name is system-generated."""
    if body.case_type not in CASE_TYPES:
        raise HTTPException(400, f"Invalid case_type. Allowed: {CASE_TYPES}")

    sb = get_user_supabase(user)
    case_seq = _next_case_sequence(sb, body.uprn)
    display_name = _generate_display_name(
        body.address, body.case_type, body.valuation_basis, body.valuation_date,
    )

    row = {
        "surveyor_id": user["id"],
        "title": display_name,  # legacy column, kept for backward compat
        "display_name": display_name,
        "case_type": body.case_type,
        "status": "in_progress",
        "case_sequence": case_seq,
        "address": body.address,
        "postcode": body.postcode,
        "uprn": body.uprn,
        "valuation_basis": body.valuation_basis,
        "firm_reference": body.firm_reference,
        "property_data": body.property_data,
        "property_snapshot": body.property_data,
        "comparables": body.comparables,
        "search_results": body.search_results or {},
        "valuation_date": body.valuation_date,
        "hpi_correlation": body.hpi_correlation,
        "size_elasticity": body.size_elasticity,
        "notes": body.notes,
        "ai_narrative": body.ai_narrative,
        "report_content": body.report_content,
        "ui_state": body.ui_state or {},
    }
    resp = sb.table("cases").insert(row).execute()
    return resp.data[0]


@router.get("")
@limiter.limit("60/minute")
async def list_cases(request: Request, user: dict = Depends(get_current_user)):
    """List all cases for the current user (summary only)."""
    sb = get_user_supabase(user)
    cols = (
        "id, display_name, title, address, postcode, uprn, "
        "case_type, status, valuation_date, case_sequence, "
        "valuation_basis, firm_reference, created_at, updated_at"
    )
    q = sb.table("cases").select(cols).eq("surveyor_id", user["id"])
    try:
        resp = q.eq("is_deleted", False).order("updated_at", desc=True).execute()
    except Exception:
        # is_deleted column may not exist yet — fall back without filter
        resp = (
            sb.table("cases").select(cols)
            .eq("surveyor_id", user["id"])
            .order("updated_at", desc=True)
            .execute()
        )
    return {"cases": resp.data}


@router.get("/{case_id}")
@limiter.limit("60/minute")
async def get_case(request: Request, case_id: str, user: dict = Depends(get_current_user)):
    """Retrieve a full saved case."""
    sb = get_user_supabase(user)
    resp = (
        sb.table("cases")
        .select("*")
        .eq("id", case_id)
        .eq("surveyor_id", user["id"])
        .execute()
    )
    if not resp.data:
        raise HTTPException(404, "Case not found")
    return resp.data[0]


@router.patch("/{case_id}")
@limiter.limit("30/minute")
async def update_case(
    request: Request, case_id: str, body: UpdateCaseRequest, user: dict = Depends(get_current_user)
):
    """Update a saved case. Enforces status flow and issued immutability."""
    sb = get_user_supabase(user)
    # Fetch current case first
    current = (
        sb.table("cases")
        .select("status, case_type")
        .eq("id", case_id)
        .eq("surveyor_id", user["id"])
        .execute()
    )
    if not current.data:
        raise HTTPException(404, "Case not found")

    current_status = current.data[0]["status"]

    # Block all edits on issued/archived cases (except status change to archive)
    if current_status in ("issued", "archived"):
        if body.status and body.status != current_status:
            allowed = STATUS_FLOW.get(current_status, [])
            if body.status not in allowed:
                raise HTTPException(
                    400,
                    f"Cannot change status from '{current_status}' to '{body.status}'. "
                    f"Allowed: {allowed or 'none (terminal)'}",
                )
            # Only allow status transition, no other edits
            updates = {"status": body.status, "updated_at": "now()"}
            if body.status == "archived":
                pass  # archived is allowed from issued
        else:
            raise HTTPException(
                403,
                "This case has been issued and is locked. "
                "No modifications are allowed on issued cases.",
            )
    else:
        updates = {k: v for k, v in body.model_dump().items() if v is not None}
        # Map property_data to the DB column property_snapshot
        if "property_data" in updates:
            updates["property_snapshot"] = updates.pop("property_data")
        if not updates:
            raise HTTPException(400, "Nothing to update")

        # Validate status transition
        if "status" in updates:
            new_status = updates["status"]
            if new_status not in CASE_STATUSES:
                raise HTTPException(400, f"Invalid status. Allowed: {CASE_STATUSES}")
            allowed = STATUS_FLOW.get(current_status, [])
            if new_status not in allowed:
                raise HTTPException(
                    400,
                    f"Cannot change status from '{current_status}' to '{new_status}'. "
                    f"Allowed transitions: {allowed}",
                )
            # Set finalised_at when issuing
            if new_status == "issued":
                updates["finalised_at"] = datetime.utcnow().isoformat()

        updates["updated_at"] = "now()"

    # Regenerate display_name if valuation fields changed
    if any(k in updates for k in ("valuation_basis", "valuation_date")):
        # Fetch full case to get address/case_type
        full = sb.table("cases").select("address, case_type, valuation_basis, valuation_date").eq("id", case_id).execute()
        if full.data:
            c = full.data[0]
            updates["display_name"] = _generate_display_name(
                c["address"],
                c["case_type"],
                updates.get("valuation_basis", c.get("valuation_basis")),
                updates.get("valuation_date", c.get("valuation_date")),
            )
            updates["title"] = updates["display_name"]

    resp = (
        sb.table("cases")
        .update(updates)
        .eq("id", case_id)
        .eq("surveyor_id", user["id"])
        .execute()
    )
    if not resp.data:
        raise HTTPException(404, "Case not found")
    return resp.data[0]


@router.delete("/{case_id}")
@limiter.limit("10/minute")
async def delete_case(request: Request, case_id: str, user: dict = Depends(get_current_user)):
    """Delete a saved case. Cannot delete issued cases."""
    sb = get_user_supabase(user)
    # Check status first
    current = (
        sb.table("cases")
        .select("status")
        .eq("id", case_id)
        .eq("surveyor_id", user["id"])
        .execute()
    )
    if not current.data:
        raise HTTPException(404, "Case not found")

    if current.data[0]["status"] == "issued":
        raise HTTPException(
            403,
            "Issued cases cannot be deleted. Archive them instead.",
        )

    try:
        resp = (
            sb.table("cases")
            .update({"is_deleted": True, "updated_at": "now()"})
            .eq("id", case_id)
            .eq("surveyor_id", user["id"])
            .execute()
        )
    except Exception:
        # is_deleted column may not exist yet — hard delete instead
        resp = (
            sb.table("cases")
            .delete()
            .eq("id", case_id)
            .eq("surveyor_id", user["id"])
            .execute()
        )
    if not resp.data:
        raise HTTPException(404, "Case not found")
    return {"deleted": True}
