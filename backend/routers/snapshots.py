"""Property Snapshots + Case Comps — CRUD for Option E (UPRN Timeline).

Every data point is an immutable snapshot anchored to a UPRN.
Cases link to snapshots via the case_comps junction table.

Endpoints:
  POST   /api/snapshots              — create a snapshot (adopt, manual, additional)
  GET    /api/case-comps?case_id=X   — list adopted comps for a case
  POST   /api/case-comps             — adopt a snapshot for a case
  PATCH  /api/case-comps/{id}        — update case-specific fields (notes, tier)
  DELETE /api/case-comps/{id}        — unadopt (soft-delete)
  POST   /api/case-comps/{id}/override — create user_override snapshot + repoint
"""

import logging
import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from supabase import create_client

from .auth import get_current_user, get_user_supabase
from .rate_limit import limiter

logger = logging.getLogger(__name__)

router = APIRouter(tags=["snapshots"])

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class CreateSnapshotRequest(BaseModel):
    """Create a new property snapshot."""
    uprn: str | None = None
    source: str = Field(..., pattern=r"^(hmlr_ppd|epc|additional|csv_import|manual|user_override)$")
    source_ref: str | None = None

    # CSV import metadata
    import_provider: str | None = None
    import_filename: str | None = None
    import_row_number: int | None = None

    # Lineage
    based_on_id: str | None = None

    # Property fields
    address: str
    postcode: str
    outward_code: str
    saon: str | None = None
    tenure: str | None = None
    property_type: str | None = None
    house_sub_type: str | None = None
    bedrooms: int | None = None
    building_name: str | None = None
    building_era: str | None = None
    build_year: int | None = None
    build_year_estimated: bool = False
    floor_area_sqm: float | None = None
    price: int | None = None
    transaction_date: str | None = None
    new_build: bool = False
    transaction_category: str | None = None
    epc_rating: str | None = None
    epc_score: int | None = None
    source_note: str | None = None
    licence_restricted: bool = False


class AdoptSnapshotRequest(BaseModel):
    """Adopt a snapshot for a case."""
    case_id: str
    snapshot_id: str
    geographic_tier: int | None = None
    tier_label: str | None = None
    spec_relaxations: list[str] | None = None
    distance_m: float | None = None
    valuer_notes: str | None = None


class CreateAndAdoptRequest(BaseModel):
    """Create a snapshot AND adopt it in one call (convenience for manual/additional)."""
    case_id: str

    # Snapshot fields
    uprn: str | None = None
    source: str = Field(..., pattern=r"^(hmlr_ppd|epc|additional|csv_import|manual|user_override)$")
    source_ref: str | None = None
    import_provider: str | None = None
    import_filename: str | None = None
    import_row_number: int | None = None
    based_on_id: str | None = None

    address: str
    postcode: str
    outward_code: str
    saon: str | None = None
    tenure: str | None = None
    property_type: str | None = None
    house_sub_type: str | None = None
    bedrooms: int | None = None
    building_name: str | None = None
    building_era: str | None = None
    build_year: int | None = None
    build_year_estimated: bool = False
    floor_area_sqm: float | None = None
    price: int | None = None
    transaction_date: str | None = None
    new_build: bool = False
    transaction_category: str | None = None
    epc_rating: str | None = None
    epc_score: int | None = None
    source_note: str | None = None
    licence_restricted: bool = False

    # Adoption context
    geographic_tier: int | None = None
    tier_label: str | None = None
    spec_relaxations: list[str] | None = None
    distance_m: float | None = None
    valuer_notes: str | None = None


class UpdateCaseCompRequest(BaseModel):
    """Update case-specific fields on an adopted comp."""
    valuer_notes: str | None = None
    geographic_tier: int | None = None
    tier_label: str | None = None


class OverrideRequest(BaseModel):
    """Override fields on an adopted comp — creates a new user_override snapshot."""
    # Only include fields being overridden (non-None fields will be changed)
    address: str | None = None
    postcode: str | None = None
    outward_code: str | None = None
    saon: str | None = None
    tenure: str | None = None
    property_type: str | None = None
    house_sub_type: str | None = None
    bedrooms: int | None = None
    building_name: str | None = None
    building_era: str | None = None
    build_year: int | None = None
    floor_area_sqm: float | None = None
    price: int | None = None
    transaction_date: str | None = None
    new_build: bool | None = None
    epc_rating: str | None = None
    epc_score: int | None = None
    source_note: str | None = None


# ---------------------------------------------------------------------------
# Helper: get firm_id for current user
# ---------------------------------------------------------------------------

def _get_firm_id(user: dict) -> str | None:
    """Extract firm_id from user's app_metadata (set by migration 015 backfill)."""
    # Try app_metadata first (set via Supabase Auth)
    app_meta = user.get("app_metadata", {})
    if app_meta and app_meta.get("firm_id"):
        return app_meta["firm_id"]

    # Fallback: query firm_members table using service role
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        return None
    try:
        sb = create_client(url, key)
        resp = sb.table("firm_members").select("firm_id").eq("user_id", user["id"]).limit(1).execute()
        if resp.data:
            return resp.data[0]["firm_id"]
    except Exception as e:
        logger.warning("firm_members lookup failed: %s", e)
    return None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/api/snapshots")
@limiter.limit("60/minute")
async def create_snapshot(
    request: Request,
    body: CreateSnapshotRequest,
    user: dict = Depends(get_current_user),
):
    """Create a new immutable property snapshot."""
    sb = get_user_supabase(user)
    firm_id = _get_firm_id(user)

    # Official sources (hmlr_ppd, epc) have no firm_id
    is_official = body.source in ("hmlr_ppd", "epc")

    row = {
        "uprn": body.uprn,
        "source": body.source,
        "source_ref": body.source_ref,
        "created_by": None if is_official else user["id"],
        "firm_id": None if is_official else firm_id,
        "import_provider": body.import_provider,
        "import_filename": body.import_filename,
        "import_row_number": body.import_row_number,
        "based_on_id": body.based_on_id,
        "address": body.address,
        "postcode": body.postcode,
        "outward_code": body.outward_code,
        "saon": body.saon,
        "tenure": body.tenure,
        "property_type": body.property_type,
        "house_sub_type": body.house_sub_type,
        "bedrooms": body.bedrooms,
        "building_name": body.building_name,
        "building_era": body.building_era,
        "build_year": body.build_year,
        "build_year_estimated": body.build_year_estimated,
        "floor_area_sqm": body.floor_area_sqm,
        "price": body.price,
        "transaction_date": body.transaction_date,
        "new_build": body.new_build,
        "transaction_category": body.transaction_category,
        "epc_rating": body.epc_rating,
        "epc_score": body.epc_score,
        "source_note": body.source_note,
        "licence_restricted": body.licence_restricted,
    }

    resp = sb.table("property_snapshots").insert(row).execute()
    if not resp.data:
        raise HTTPException(500, "Failed to create snapshot")

    logger.info("Snapshot created: %s source=%s uprn=%s", resp.data[0]["id"], body.source, body.uprn)
    return resp.data[0]


@router.post("/api/snapshots/adopt")
@limiter.limit("60/minute")
async def create_and_adopt(
    request: Request,
    body: CreateAndAdoptRequest,
    user: dict = Depends(get_current_user),
):
    """Create a snapshot AND adopt it for a case in one call.

    Convenience endpoint for manual entry, additional comps, and system adopt.
    """
    sb = get_user_supabase(user)
    firm_id = _get_firm_id(user)

    is_official = body.source in ("hmlr_ppd", "epc")

    # 1. Check for existing snapshot with same source_ref (avoid duplicates)
    snapshot_id = None
    if body.source_ref:
        existing = (
            sb.table("property_snapshots")
            .select("id")
            .eq("source_ref", body.source_ref)
            .eq("source", body.source)
            .limit(1)
            .execute()
        )
        if existing.data:
            snapshot_id = existing.data[0]["id"]

    # 2. Create snapshot if not already existing
    if not snapshot_id:
        snap_row = {
            "uprn": body.uprn,
            "source": body.source,
            "source_ref": body.source_ref,
            "created_by": None if is_official else user["id"],
            "firm_id": None if is_official else firm_id,
            "import_provider": body.import_provider,
            "import_filename": body.import_filename,
            "import_row_number": body.import_row_number,
            "based_on_id": body.based_on_id,
            "address": body.address,
            "postcode": body.postcode,
            "outward_code": body.outward_code,
            "saon": body.saon,
            "tenure": body.tenure,
            "property_type": body.property_type,
            "house_sub_type": body.house_sub_type,
            "bedrooms": body.bedrooms,
            "building_name": body.building_name,
            "building_era": body.building_era,
            "build_year": body.build_year,
            "build_year_estimated": body.build_year_estimated,
            "floor_area_sqm": body.floor_area_sqm,
            "price": body.price,
            "transaction_date": body.transaction_date,
            "new_build": body.new_build,
            "transaction_category": body.transaction_category,
            "epc_rating": body.epc_rating,
            "epc_score": body.epc_score,
            "source_note": body.source_note,
            "licence_restricted": body.licence_restricted,
        }
        snap_resp = sb.table("property_snapshots").insert(snap_row).execute()
        if not snap_resp.data:
            raise HTTPException(500, "Failed to create snapshot")
        snapshot_id = snap_resp.data[0]["id"]

    # 3. Create case_comps junction
    comp_row = {
        "case_id": body.case_id,
        "snapshot_id": snapshot_id,
        "adopted_by": user["id"],
        "geographic_tier": body.geographic_tier,
        "tier_label": body.tier_label,
        "spec_relaxations": body.spec_relaxations,
        "distance_m": body.distance_m,
        "valuer_notes": body.valuer_notes,
    }

    try:
        comp_resp = sb.table("case_comps").insert(comp_row).execute()
    except Exception as e:
        err = str(e)
        if "duplicate" in err.lower() or "unique" in err.lower():
            raise HTTPException(409, "This comparable is already adopted for this case")
        raise HTTPException(500, f"Failed to adopt snapshot: {err}")

    if not comp_resp.data:
        raise HTTPException(500, "Failed to create case_comp")

    logger.info("Snapshot %s adopted for case %s", snapshot_id, body.case_id)

    # 4. Return the joined result
    return {
        "case_comp": comp_resp.data[0],
        "snapshot_id": snapshot_id,
    }


@router.get("/api/case-comps")
@limiter.limit("60/minute")
async def list_case_comps(
    request: Request,
    case_id: str,
    user: dict = Depends(get_current_user),
):
    """List all adopted comparables for a case (JOIN snapshots)."""
    sb = get_user_supabase(user)

    # Query case_comps with snapshot data via Supabase's foreign key join
    resp = (
        sb.table("case_comps")
        .select("*, property_snapshots(*)")
        .eq("case_id", case_id)
        .is_("unadopted_at", "null")
        .order("adopted_at", desc=False)
        .execute()
    )

    return {"case_id": case_id, "comps": resp.data}


@router.post("/api/case-comps")
@limiter.limit("60/minute")
async def adopt_snapshot(
    request: Request,
    body: AdoptSnapshotRequest,
    user: dict = Depends(get_current_user),
):
    """Adopt an existing snapshot for a case."""
    sb = get_user_supabase(user)

    comp_row = {
        "case_id": body.case_id,
        "snapshot_id": body.snapshot_id,
        "adopted_by": user["id"],
        "geographic_tier": body.geographic_tier,
        "tier_label": body.tier_label,
        "spec_relaxations": body.spec_relaxations,
        "distance_m": body.distance_m,
        "valuer_notes": body.valuer_notes,
    }

    try:
        resp = sb.table("case_comps").insert(comp_row).execute()
    except Exception as e:
        err = str(e)
        if "duplicate" in err.lower() or "unique" in err.lower():
            raise HTTPException(409, "Already adopted")
        raise HTTPException(500, f"Failed to adopt: {err}")

    if not resp.data:
        raise HTTPException(500, "Failed to adopt snapshot")
    return resp.data[0]


@router.patch("/api/case-comps/{comp_id}")
@limiter.limit("30/minute")
async def update_case_comp(
    request: Request,
    comp_id: str,
    body: UpdateCaseCompRequest,
    user: dict = Depends(get_current_user),
):
    """Update case-specific fields (notes, tier) on an adopted comp."""
    sb = get_user_supabase(user)

    updates = {}
    if body.valuer_notes is not None:
        updates["valuer_notes"] = body.valuer_notes
    if body.geographic_tier is not None:
        updates["geographic_tier"] = body.geographic_tier
    if body.tier_label is not None:
        updates["tier_label"] = body.tier_label

    if not updates:
        raise HTTPException(400, "No fields to update")

    resp = sb.table("case_comps").update(updates).eq("id", comp_id).execute()
    if not resp.data:
        raise HTTPException(404, "Case comp not found")
    return resp.data[0]


@router.delete("/api/case-comps/{comp_id}")
@limiter.limit("30/minute")
async def unadopt_comp(
    request: Request,
    comp_id: str,
    user: dict = Depends(get_current_user),
):
    """Unadopt a comparable (soft-delete — sets unadopted_at timestamp)."""
    sb = get_user_supabase(user)

    resp = (
        sb.table("case_comps")
        .update({"unadopted_at": datetime.utcnow().isoformat()})
        .eq("id", comp_id)
        .is_("unadopted_at", "null")
        .execute()
    )

    if not resp.data:
        raise HTTPException(404, "Case comp not found or already unadopted")
    return {"unadopted": True, "id": comp_id}


@router.post("/api/case-comps/{comp_id}/override")
@limiter.limit("30/minute")
async def override_comp(
    request: Request,
    comp_id: str,
    body: OverrideRequest,
    user: dict = Depends(get_current_user),
):
    """Create a user_override snapshot and repoint the case_comp to it.

    The original snapshot remains untouched — edit history is the
    chain of based_on_id references.
    """
    sb = get_user_supabase(user)
    firm_id = _get_firm_id(user)

    # 1. Get the current case_comp + snapshot
    comp_resp = (
        sb.table("case_comps")
        .select("*, property_snapshots(*)")
        .eq("id", comp_id)
        .is_("unadopted_at", "null")
        .execute()
    )
    if not comp_resp.data:
        raise HTTPException(404, "Case comp not found")

    comp = comp_resp.data[0]
    original_snapshot = comp.get("property_snapshots", {})
    original_snapshot_id = comp["snapshot_id"]

    if not original_snapshot:
        raise HTTPException(500, "Snapshot data missing")

    # 2. Build the new snapshot — start with all fields from original, apply overrides
    override_fields = body.model_dump(exclude_none=True)
    if not override_fields:
        raise HTTPException(400, "No fields to override")

    # Copy all property fields from original snapshot
    property_fields = [
        "address", "postcode", "outward_code", "saon", "tenure",
        "property_type", "house_sub_type", "bedrooms", "building_name",
        "building_era", "build_year", "floor_area_sqm", "price",
        "transaction_date", "new_build", "transaction_category",
        "epc_rating", "epc_score",
    ]

    new_snap = {
        "uprn": original_snapshot.get("uprn"),
        "source": "user_override",
        "source_ref": original_snapshot.get("source_ref"),
        "created_by": user["id"],
        "firm_id": firm_id,
        "based_on_id": original_snapshot_id,
        "licence_restricted": original_snapshot.get("licence_restricted", False),
    }

    for field in property_fields:
        if field in override_fields:
            new_snap[field] = override_fields[field]
        else:
            new_snap[field] = original_snapshot.get(field)

    # source_note from override or original
    new_snap["source_note"] = override_fields.get("source_note", original_snapshot.get("source_note"))

    # 3. Insert new snapshot
    snap_resp = sb.table("property_snapshots").insert(new_snap).execute()
    if not snap_resp.data:
        raise HTTPException(500, "Failed to create override snapshot")

    new_snapshot_id = snap_resp.data[0]["id"]

    # 4. Repoint case_comp to new snapshot
    update_resp = (
        sb.table("case_comps")
        .update({"snapshot_id": new_snapshot_id})
        .eq("id", comp_id)
        .execute()
    )

    logger.info(
        "Override: case_comp %s repointed %s → %s (fields: %s)",
        comp_id, original_snapshot_id, new_snapshot_id,
        list(override_fields.keys()),
    )

    return {
        "case_comp_id": comp_id,
        "original_snapshot_id": original_snapshot_id,
        "new_snapshot_id": new_snapshot_id,
        "overridden_fields": list(override_fields.keys()),
    }
