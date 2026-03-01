import os
import re
import traceback
from difflib import SequenceMatcher

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/property", tags=["property"])

EPC_API_BASE = "https://epc.opendatacommunities.org/api/v1/domestic/search"


class SearchRequest(BaseModel):
    address: str


def extract_postcode(address: str) -> str | None:
    pattern = r"[A-Z]{1,2}[0-9][0-9A-Z]?\s*[0-9][A-Z]{2}"
    match = re.search(pattern, address.upper())
    return match.group().strip() if match else None


def build_epc_address(row: dict) -> str:
    parts = [
        row.get("address1", ""),
        row.get("address2", ""),
        row.get("address3", ""),
        row.get("posttown", ""),
        row.get("postcode", ""),
    ]
    return " ".join(p for p in parts if p)


def house_number(address: str) -> str | None:
    """Extract the first numeric token from an address string.

    Examples:
        "Flat 38, Some Road"  -> "38"
        "41 Gander Green Lane" -> "41"
        "Unit 2B High Street"  -> "2"  (leading digits of alphanumeric token)
    """
    match = re.search(r"\b(\d+)", address)
    return match.group(1) if match else None


# Keywords that indicate a SAON (secondary addressable object) — flat/unit/apartment
_SAON_PREFIXES = re.compile(
    r"\b(flat|apartment|apt|unit|room|suite|floor)\b", re.IGNORECASE
)


def is_saon(address: str) -> bool:
    """Return True if the address appears to be a flat/unit/apartment."""
    return bool(_SAON_PREFIXES.search(address))


def combined_score(query: str, candidate: str) -> float:
    """Score a candidate address against the query.

    Weighting: 50% fuzzy string similarity + 50% exact house/flat number match.
    """
    fuzzy = SequenceMatcher(None, query.lower(), candidate.lower()).ratio()

    query_num = house_number(query)
    candidate_num = house_number(candidate)

    if query_num is not None and candidate_num is not None:
        number_match = 1.0 if query_num == candidate_num else 0.0
    else:
        # If either side has no number, fall back to pure fuzzy
        number_match = fuzzy

    return 0.5 * fuzzy + 0.5 * number_match


@router.post("/search")
async def search_property(body: SearchRequest):
    try:
        postcode = extract_postcode(body.address)
        if not postcode:
            raise HTTPException(
                status_code=422,
                detail="Could not extract a valid UK postcode from the address.",
            )

        epc_email = os.getenv("EPC_EMAIL")
        epc_api_key = os.getenv("EPC_API_KEY")
        if not epc_email or not epc_api_key:
            raise HTTPException(
                status_code=500, detail="EPC API credentials are not configured."
            )

        print(f"DEBUG: postcode={postcode}, epc_email_set={bool(epc_email)}, key_len={len(epc_api_key)}")

        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                EPC_API_BASE,
                params={"postcode": postcode, "size": 5000},
                auth=(epc_email, epc_api_key),
                headers={"Accept": "application/json"},
            )

        print(f"DEBUG: EPC API response status={response.status_code}")

        if response.status_code == 401:
            raise HTTPException(status_code=502, detail="EPC API authentication failed.")
        if response.status_code != 200:
            raise HTTPException(
                status_code=502, detail=f"EPC API returned {response.status_code}."
            )

        rows = response.json().get("rows", [])
        if not rows:
            raise HTTPException(
                status_code=404,
                detail=f"No EPC records found for postcode {postcode}.",
            )

        best = max(rows, key=lambda r: combined_score(body.address, build_epc_address(r)))

        return {
            "uprn": best.get("uprn"),
            "address": build_epc_address(best),
            "energy_rating": best.get("current-energy-rating"),
            "energy_score": best.get("current-energy-efficiency"),
            "property_type": best.get("property-type"),
            "built_form": best.get("built-form"),
            "floor_area_m2": best.get("total-floor-area"),
            "construction_age_band": best.get("construction-age-band"),
            "num_rooms": best.get("number-habitable-rooms"),
            "heating_type": best.get("main-fuel"),
            "inspection_date": best.get("inspection-date"),
        }
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
