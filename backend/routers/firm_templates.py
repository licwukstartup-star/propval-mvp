"""Firm template CRUD — Category A boilerplate for RICS reports.

Phase 1: one template per surveyor (single firm).
Future: migrate to firm_id with shared access across firm members.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .auth import get_current_user, get_user_supabase
from .rate_limit import limiter

router = APIRouter(prefix="/api/firm-templates", tags=["firm-templates"])


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
TEMPLATE_FIELDS = [
    "instructions", "purpose", "responsibility", "disclosure",
    "pi_insurance", "expertise", "inspection", "environmental",
    "asbestos", "fire_risk", "methodology", "general_comments",
    "firm_name", "firm_address", "firm_rics_number",
    # Purpose of valuation dropdown options (JSON array string)
    "purpose_options",
    # AI prompt customisation fields
    "ai_prompt_location",
    "ai_prompt_subject_development", "ai_prompt_subject_building", "ai_prompt_subject_property",
    "ai_prompt_market", "ai_prompt_valuation",
]


DEFAULT_BOILERPLATE: dict[str, str] = {
    "firm_name": "",
    "firm_address": "",
    "firm_rics_number": "",
    "instructions": (
        "We have been instructed by the named client to undertake a valuation "
        "of the above property for mortgage/secured lending purposes in accordance "
        "with the RICS Valuation – Global Standards (effective 31 January 2022), "
        "the UK National Supplement (effective November 2023), and the requirements "
        "of the instructing lender's current valuation specification."
    ),
    "purpose": (
        "This valuation has been prepared for {purpose_of_valuation} purposes "
        "for the sole use of the instructing party and their successors in title. "
        "The valuation must not be used for any purpose other than that stated. "
        "No responsibility is accepted to any other party who may seek to rely upon "
        "the whole or any part of the contents of this report for any other purpose."
    ),
    "responsibility": (
        "This report is provided for the stated purpose and for the use of the named "
        "client only. No responsibility is accepted to any third party who may use or "
        "rely upon the whole or any part of the contents of this report. No liability "
        "is accepted for any loss arising from reliance upon the report by any person "
        "contrary to this statement."
    ),
    "disclosure": (
        "We confirm that we have no material connection or involvement with the "
        "property, borrower, or any other party that could give rise to a conflict "
        "of interest. We have had no previous involvement with the property within "
        "the preceding 12 months. If any potential conflict were to arise, it would "
        "be disclosed to the client prior to proceeding with the instruction."
    ),
    "pi_insurance": (
        "Professional indemnity insurance is maintained in accordance with RICS "
        "requirements and is provided by a recognised insurer with an appropriate "
        "limit of indemnity. Details are available upon request."
    ),
    "expertise": (
        "The valuer has sufficient current local knowledge of the particular market "
        "and the skills and understanding to undertake the valuation competently. "
        "The valuer is a Registered Valuer as defined in the RICS Valuation – Global "
        "Standards and acts as an External Valuer as defined therein."
    ),
    "inspection": (
        "An internal and external inspection of the property was carried out on the "
        "date stated. The inspection was conducted in daylight hours and in accordance "
        "with RICS guidance. Furniture, floor coverings, and stored items were not "
        "moved during the inspection. Areas that could not be inspected are noted in "
        "the body of this report."
    ),
    "environmental": (
        "We have not carried out any investigation into the presence or potential "
        "presence of contamination, pollutants, or hazardous substances in or on "
        "the land, nor have we assessed the susceptibility of the property to such "
        "contamination. We have assumed that the property is not adversely affected "
        "and that no contaminative or potentially contaminative uses have ever been "
        "carried out on the site."
    ),
    "asbestos": (
        "We have not carried out an asbestos inspection and have not acted as an "
        "asbestos inspector in completing this valuation. For properties constructed "
        "before the year 2000, it should be assumed that asbestos-containing materials "
        "may be present. No asbestos register was made available for our inspection. "
        "Should an asbestos survey reveal the presence of regulated materials, costs "
        "of treatment or removal could adversely affect the reported value."
    ),
    "fire_risk": (
        "We have not carried out a fire risk assessment of the property and are not "
        "qualified to do so. For buildings above 11 metres in height containing "
        "residential dwellings, an External Wall System Fire Review (EWS1) form may "
        "be required by lenders. Where applicable, we have noted the external wall "
        "construction and any cladding present. Our valuation assumes that the "
        "building meets current fire safety standards unless otherwise stated."
    ),
    "methodology": (
        "We have adopted the comparative method of valuation, having regard to recent "
        "comparable transactions in the locality, adjusted where appropriate for "
        "differences in location, size, condition, specification, and tenure. "
        "Where insufficient transactional evidence exists, reference has also been "
        "made to asking prices and available market intelligence."
    ),
    "general_comments": (
        "Our valuation has been prepared on the basis of the information available "
        "to us at the date of valuation and reflects the state of the market at that "
        "date. Values can change over relatively short periods of time, and the "
        "valuer accepts no responsibility for fluctuations in the market after the "
        "valuation date. This valuation is current only at the date stated and may "
        "not be valid at a later date."
    ),
    # Purpose of valuation dropdown options — JSON array
    "purpose_options": '["Secured Lending","Help to Buy","Right to Buy","Shared Ownership","Shared Equity","Equity Release","Capital Gains Tax (CGT)","Probate / Inheritance Tax","Matrimonial / Divorce","Insurance Reinstatement","Litigation","Accounting / Financial Reporting","Company Accounts","Tax Planning","Portfolio Valuation","Transfer / Acquisition","Lease Extension / Enfranchisement","Private / Market Appraisal","Development Appraisal"]',
    # AI prompt customisation — empty string means "use system default"
    "ai_prompt_location": "",
    "ai_prompt_subject_development": "",
    "ai_prompt_subject_building": "",
    "ai_prompt_subject_property": "",
    "ai_prompt_market": "",
    "ai_prompt_valuation": "",
}


class FirmTemplateUpdate(BaseModel):
    instructions: str | None = None
    purpose: str | None = None
    responsibility: str | None = None
    disclosure: str | None = None
    pi_insurance: str | None = None
    expertise: str | None = None
    inspection: str | None = None
    environmental: str | None = None
    asbestos: str | None = None
    fire_risk: str | None = None
    methodology: str | None = None
    general_comments: str | None = None
    firm_name: str | None = None
    firm_address: str | None = None
    firm_rics_number: str | None = None
    purpose_options: str | None = None
    ai_prompt_location: str | None = None
    ai_prompt_subject_development: str | None = None
    ai_prompt_subject_building: str | None = None
    ai_prompt_subject_property: str | None = None
    ai_prompt_market: str | None = None
    ai_prompt_valuation: str | None = None


# ---------------------------------------------------------------------------
# GET — retrieve current surveyor's firm template
# ---------------------------------------------------------------------------
@router.get("")
@limiter.limit("60/minute")
async def get_firm_template(request: Request, user=Depends(get_current_user)):
    uid = user["id"]
    sb = get_user_supabase(user)
    resp = (
        sb.table("firm_templates")
        .select("*")
        .eq("surveyor_id", uid)
        .execute()
    )
    if resp.data:
        return resp.data[0]
    # No template yet — return professional defaults
    return DEFAULT_BOILERPLATE.copy()


# ---------------------------------------------------------------------------
# PUT — upsert (create or update) the firm template
# ---------------------------------------------------------------------------
@router.put("")
@limiter.limit("20/minute")
async def upsert_firm_template(
    request: Request,
    body: FirmTemplateUpdate,
    user=Depends(get_current_user),
):
    uid = user["id"]
    sb = get_user_supabase(user)
    # Build update dict from non-None fields only
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")

    # Check if template exists
    existing = (
        sb.table("firm_templates")
        .select("id")
        .eq("surveyor_id", uid)
        .execute()
    )

    try:
        if existing.data:
            resp = (
                sb.table("firm_templates")
                .update(updates)
                .eq("surveyor_id", uid)
                .execute()
            )
        else:
            updates["surveyor_id"] = uid
            resp = (
                sb.table("firm_templates")
                .insert(updates)
                .execute()
            )
    except (Exception, BaseException):
        # Retry without AI prompt fields (columns may not exist yet)
        ai_keys = [k for k in updates if k.startswith("ai_prompt_")]
        if ai_keys:
            for k in ai_keys:
                updates.pop(k)
            if not updates or (len(updates) == 1 and "surveyor_id" in updates):
                raise HTTPException(400, "No fields to update")
            if existing.data:
                resp = sb.table("firm_templates").update(updates).eq("surveyor_id", uid).execute()
            else:
                resp = sb.table("firm_templates").insert(updates).execute()
        else:
            raise

    if resp.data:
        return resp.data[0]
    raise HTTPException(500, "Failed to save firm template")
