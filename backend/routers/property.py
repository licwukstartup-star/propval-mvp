import asyncio
import logging
import math
import os
import re
import traceback
from datetime import datetime
from pathlib import Path
from difflib import SequenceMatcher

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from routers.auth import get_current_user
from playwright.sync_api import sync_playwright
from pydantic import BaseModel
from shapely.geometry import Point, shape

router = APIRouter(prefix="/api/property", tags=["property"])

# ---------------------------------------------------------------------------
# Supabase client (lazy — only initialised when env vars are present)
# ---------------------------------------------------------------------------

_supabase_client = None


def _get_supabase():
    global _supabase_client
    if _supabase_client is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if url and key:
            from supabase import create_client
            _supabase_client = create_client(url, key)
    return _supabase_client

# ---------------------------------------------------------------------------
# Green Belt — in-memory Shapely polygons (loaded via FastAPI lifespan)
# Avoids intermittent false positives from planning.data.gov.uk geometry engine
# ---------------------------------------------------------------------------

GREEN_BELT_GEOJSON_URL = "https://files.planning.data.gov.uk/dataset/green-belt.geojson"
_green_belt_polygons: list[tuple[str, object]] = []  # (name, shapely_geom)


def _load_green_belt_polygons() -> None:
    """Download the planning.data.gov.uk green-belt GeoJSON and build Shapely shapes.

    Called once from main.py lifespan on startup. Falls back silently to an
    empty list so the rest of the app keeps working if the download fails.
    """
    global _green_belt_polygons
    try:
        resp = httpx.get(GREEN_BELT_GEOJSON_URL, timeout=60.0, follow_redirects=True)
        resp.raise_for_status()
        features = resp.json().get("features", [])
        polys = []
        for feat in features:
            try:
                geom = shape(feat["geometry"])
                if geom.geom_type not in ("Polygon", "MultiPolygon"):
                    continue
                name = feat.get("properties", {}).get("name", "")
                polys.append((name, geom))
            except Exception as exc:
                logging.warning("Green Belt: could not parse feature: %s", exc)
        _green_belt_polygons = polys
        print(f"Green Belt: loaded {len(polys)} polygons from planning.data.gov.uk")
    except Exception as exc:
        logging.warning(f"Green Belt GeoJSON download failed: {exc}. Green belt check disabled.")
        _green_belt_polygons = []


EPC_API_BASE = "https://epc.opendatacommunities.org/api/v1/domestic/search"
SPARQL_ENDPOINT = "https://landregistry.data.gov.uk/landregistry/query"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
POSTCODES_IO_URL = "https://api.postcodes.io/postcodes"

# Postcode → EPC rows cache (process-lifetime).
# Populated by /autocomplete so the subsequent /search call avoids a second EPC round-trip.
_autocomplete_cache: dict[str, list[dict]] = {}

# Historic England NHLE — listed buildings within 75 m
NHLE_URL = "https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/0/query"
PLANNING_DATA_URL = "https://www.planning.data.gov.uk/entity.json"

# EA flood risk — NaFRA2 (Jan 2025) via environment.data.gov.uk WMS (public, no auth)
NAFRA2_RS_WMS = "https://environment.data.gov.uk/spatialdata/nafra2-risk-of-flooding-from-rivers-and-sea/wms"

# Surface water — older EA ArcGIS Open Data layers (still current public source)
_EA_BASE = "https://services-eu1.arcgis.com/KB6uNVj5ZcJr7jUP/arcgis/rest/services"
EA_ROFSW_1IN30_URL   = f"{_EA_BASE}/RoFSWExtent1in30/FeatureServer/0/query"
EA_ROFSW_1IN100_URL  = f"{_EA_BASE}/RoFSWExtent1in100/FeatureServer/0/query"
EA_ROFSW_1IN1000_URL = f"{_EA_BASE}/RoFSWExtent1in1000/FeatureServer/0/query"

# Coal Authority planning policy constraints WMS (BGS-hosted, public, no auth)
COAL_AUTHORITY_WMS = "https://map.bgs.ac.uk/arcgis/services/CoalAuthority/coalauthority_planning_policy_constraints/MapServer/WMSServer"
BGS_RADON_WMS = "https://map.bgs.ac.uk/arcgis/services/GeoIndex_Onshore/radon/MapServer/WmsServer"

# BGS GeoSure ground hazards — hex_grids MapServer (5 km hex polygons, ArcGIS REST)
_BGS_HEX = "https://map.bgs.ac.uk/arcgis/rest/services/GeoIndex_Onshore/hex_grids/MapServer"
BGS_GS_SHRINK_SWELL   = f"{_BGS_HEX}/6/query"
BGS_GS_LANDSLIDES     = f"{_BGS_HEX}/4/query"
BGS_GS_COMPRESSIBLE   = f"{_BGS_HEX}/3/query"
BGS_GS_COLLAPSIBLE    = f"{_BGS_HEX}/2/query"
BGS_GS_RUNNING_SAND   = f"{_BGS_HEX}/5/query"
BGS_GS_SOLUBLE_ROCKS  = f"{_BGS_HEX}/7/query"

# Natural England designated sites (ArcGIS Online — public, no auth)
_NE_BASE = "https://services.arcgis.com/JJzESW51TqeY9uat/arcgis/rest/services"
NE_SSSI_URL = f"{_NE_BASE}/SSSI_England/FeatureServer/0/query"
NE_AONB_URL = f"{_NE_BASE}/Areas_of_Outstanding_Natural_Beauty_England/FeatureServer/0/query"
NE_AW_URL   = f"{_NE_BASE}/Ancient_Woodland_England/FeatureServer/0/query"


class SearchRequest(BaseModel):
    address: str


# ---------------------------------------------------------------------------
# Address helpers
# ---------------------------------------------------------------------------

def extract_postcode(address: str) -> str | None:
    pattern = r"[A-Z]{1,2}[0-9][0-9A-Z]?\s*[0-9][A-Z]{2}"
    match = re.search(pattern, address.upper())
    return match.group().strip() if match else None


def normalise_postcode(postcode: str) -> str:
    """Ensure postcode has an infix space: 'SM12EG' → 'SM1 2EG'."""
    pc = postcode.strip().upper().replace(" ", "")
    return pc[:-3] + " " + pc[-3:]


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
    """Return the first house/flat number (with optional letter suffix) in an address.

    Examples: 'Flat 38B ...' → '38B', '5A High Street' → '5A', '10 ...' → '10'
    The letter suffix distinguishes e.g. 5A from 5B — both would otherwise return '5'.
    """
    match = re.search(r"\b(\d+[A-Za-z]?)\b", address)
    return match.group(1).upper() if match else None


_SAON_RE = re.compile(
    r"\b(flat|apartment|apt|unit|room|suite|floor)\b", re.IGNORECASE
)


def is_saon(address: str) -> bool:
    return bool(_SAON_RE.search(address))


# Road-name abbreviation expansion for street comparison
_ROAD_ABBR = {
    r"\bST\b": "STREET", r"\bRD\b": "ROAD", r"\bAVE\b": "AVENUE",
    r"\bDR\b": "DRIVE", r"\bLN\b": "LANE", r"\bCL\b": "CLOSE",
    r"\bCT\b": "COURT", r"\bPL\b": "PLACE", r"\bGDNS\b": "GARDENS",
    r"\bCRES\b": "CRESCENT", r"\bWK\b": "WALK",
}


def _normalise_street(s: str) -> str:
    s = s.strip().upper()
    s = re.sub(r"^\d+[\s,]+", "", s)  # strip leading number ("1 HIGH ST" or "98, THE QUAYS" → "THE QUAYS")
    s = re.sub(r"^[,\s]+", "", s)     # strip leading commas/spaces (e.g. ", CUTTER LANE" → "CUTTER LANE")
    for abbr, full in _ROAD_ABBR.items():
        s = re.sub(abbr, full, s)
    return s


def _paon_match(epc_paon: str, lr_paon: str) -> bool:
    """Match EPC-derived PAON against Land Registry PAON.

    LR sometimes bundles building name + number with a comma:
    'WESTMARK TOWER, 1' — so we check each comma-separated part.
    """
    if epc_paon == lr_paon:
        return True
    for part in lr_paon.split(","):
        if epc_paon == part.strip():
            return True
    for part in epc_paon.split(","):
        if lr_paon == part.strip():
            return True
    return False


def _saon_num(s: str) -> str | None:
    """Extract the numeric identifier from a SAON ('FLAT 38B' → '38B')."""
    m = re.search(r"\b(\d+[A-Z]?)\b", s.upper())
    return m.group(1) if m else None


def parse_user_address_parts(address: str, postcode: str) -> dict[str, str | None]:
    """Derive SAON / PAON / street from a free-form user address string.

    Used as a fallback when no EPC record exists for the property.

    Examples:
      "5 Horse Shoe Green, Sutton, SM1 3LS" → saon=None, paon="5", street="HORSE SHOE GREEN"
      "Flat 3, 12 High Street, London, E1"  → saon="FLAT 3", paon="12", street="HIGH STREET"
    """
    # Strip postcode and normalise
    pc_pat = re.sub(r"\s+", r"\\s*", re.escape(postcode.strip().upper()))
    clean = re.sub(pc_pat, "", address.strip().upper(), flags=re.IGNORECASE)
    clean = re.sub(r"\s+", " ", clean).strip(" ,")

    # Split on commas; each segment is e.g. ["5 HORSE SHOE GREEN", "SUTTON"]
    segments = [s.strip() for s in clean.split(",") if s.strip()]
    if not segments:
        return {"saon": None, "paon": None, "street": None}

    saon: str | None = None
    # Check whether the first segment is a SAON ("FLAT 3", "UNIT 2B", …)
    if is_saon(segments[0]):
        m_saon = re.match(
            r"^((?:FLAT|APARTMENT|APT|UNIT|ROOM|SUITE|FLOOR)\s+\d+\w*)",
            segments[0],
        )
        saon = m_saon.group(1) if m_saon else segments[0]
        prop_part = segments[1] if len(segments) > 1 else ""
    else:
        prop_part = segments[0]

    # Extract leading house/building number and remainder as street
    m = re.match(r"^(\d+\w*)\s+(.*)", prop_part.strip())
    if m:
        paon: str | None = m.group(1)
        street: str | None = m.group(2).strip() or None
    elif prop_part:
        paon = prop_part
        street = None
    else:
        paon = None
        street = None

    # Strip leading commas/whitespace from street (e.g. ", CUTTER LANE" → "CUTTER LANE")
    if street:
        street = re.sub(r"^[,\s]+", "", street) or None
    return {"saon": saon, "paon": paon, "street": street}


def parse_address_parts(epc_row: dict) -> dict[str, str | None]:
    """Derive SAON / PAON / street from EPC row fields for Land Registry matching.

    EPC address1 can come in several forms:
      "FLAT 38"                  → SAON="FLAT 38",   PAON from address2, street from address3
      "FLAT 170 COMPASS HOUSE"   → SAON="FLAT 170",  PAON="COMPASS HOUSE", street from address2
      "41 HIGH ST"               → SAON=None,        PAON="41", street from address2
    """
    a1 = epc_row.get("address1", "").strip().upper()
    a2 = epc_row.get("address2", "").strip().upper()
    a3 = epc_row.get("address3", "").strip().upper()

    if is_saon(a1):
        # Extract "FLAT NNN" (or APARTMENT/APT/UNIT/etc.) as SAON
        m_saon = re.match(
            r"^((?:FLAT|APARTMENT|APT|UNIT|ROOM|SUITE|FLOOR)\s+\d+\w*)",
            a1,
            re.IGNORECASE,
        )
        if m_saon:
            saon = m_saon.group(1)
            remainder = a1[m_saon.end():].strip()
            if remainder:
                # Building name is embedded in address1 (e.g. "FLAT 170 COMPASS HOUSE")
                # → PAON=building name, street is in address2
                paon = remainder
                street = a2 or None
            else:
                # Building name/number is in address2; street is in address3.
                # When a3 is absent, the street name is the remainder of a2
                # after the leading number (e.g. "3 RIVERLIGHT QUAY" → paon=3, street=RIVERLIGHT QUAY)
                m = re.match(r"^(\d+\w*)\s*(.*)", a2)
                if m:
                    paon = m.group(1)
                    street = a3 or m.group(2).strip() or None
                else:
                    paon = a2
                    street = a3 or None
        else:
            saon = a1
            m = re.match(r"^(\d+\w*)\s*(.*)", a2)
            if m:
                paon = m.group(1)
                street = a3 or m.group(2).strip() or None
            else:
                paon = a2
                street = a3 or None
    else:
        saon = None
        m = re.match(r"^(\d+\w*)", a1)
        paon = m.group(1) if m else a1
        street = a2 or None

    # Strip leading commas/whitespace from street (e.g. ", CUTTER LANE" → "CUTTER LANE")
    if street:
        street = re.sub(r"^[,\s]+", "", street) or None
    return {"saon": saon, "paon": paon, "street": street}


# ---------------------------------------------------------------------------
# Fuzzy / combined scoring
# ---------------------------------------------------------------------------

def _street_part(address: str) -> str:
    """Return the street/road part of an address (text after the house number).

    E.g. '5 Horse Shoe Green, Sutton' → 'horse shoe green sutton'
    Used to catch same-number, different-street false positives.
    """
    # Drop text before first digit block (the house number)
    s = re.sub(r"^\s*\d+[A-Za-z]?\s*", "", address, count=1)
    # Keep only alpha chars + spaces; collapse whitespace
    s = re.sub(r"[^A-Za-z\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip().lower()


def combined_score(query: str, candidate: str) -> float:
    """Score an EPC candidate address against the user query.

    Rules (in priority order):
    1. House/flat number mismatch → 0.0 (hard reject — wrong property)
    2. Street name similarity < 0.4 → 0.0 (different road, same number)
    3. Otherwise: 50% overall fuzzy + 50% house-number component
    """
    fuzzy = SequenceMatcher(None, query.lower(), candidate.lower()).ratio()
    q_num = house_number(query)
    c_num = house_number(candidate)

    # Rule 1: house number must match when both sides have one
    if q_num is not None and c_num is not None:
        if q_num != c_num:
            return 0.0          # different property — hard reject
        number_match = 1.0
    else:
        number_match = fuzzy

    # Rule 2: street name must be plausibly the same road
    q_street = _street_part(query)
    c_street = _street_part(candidate)
    if q_street and c_street:
        street_sim = SequenceMatcher(None, q_street, c_street).ratio()
        if street_sim < 0.4:
            return 0.0          # different road — hard reject

    return 0.5 * fuzzy + 0.5 * number_match


# ---------------------------------------------------------------------------
# Land Registry helpers
# ---------------------------------------------------------------------------

def _lr_label(uri: str) -> str:
    """'http://…/def/common/freehold' → 'Freehold'."""
    if not uri:
        return ""
    fragment = uri.rsplit("/", 1)[-1]
    return fragment.replace("-", " ").title()


def _format_sale(b: dict) -> dict:
    nb_val = b.get("newBuild", {}).get("value", "").lower()
    return {
        "date": b.get("date", {}).get("value", "")[:10],
        "price": int(float(b.get("amount", {}).get("value", 0))),
        "tenure": _lr_label(b.get("estateType", {}).get("value", "")),
        "property_type": _lr_label(b.get("propertyType", {}).get("value", "")),
        "new_build": nb_val in ("true", "y", "yes"),
    }


def _filter_sales(bindings: list[dict], parts: dict[str, str | None]) -> list[dict]:
    """Filter raw SPARQL bindings to those matching street/SAON/PAON, newest first."""
    saon       = parts.get("saon")    # e.g. "FLAT 38" or None
    paon       = parts.get("paon")    # e.g. "41"
    epc_street = parts.get("street")  # e.g. "HIGH STREET"
    epc_street_norm = _normalise_street(epc_street) if epc_street else None

    # Build PAON alternatives to try.
    # When EPC PAON is a named building (no digits) and the street starts with a number,
    # LR stores the street number as PAON rather than the building name.
    # e.g. EPC: paon="N V BUILDING" street="98, THE QUAYS" → also try paon="98"
    paon_alts: list[str] = []
    if paon:
        paon_alts.append(paon.upper())
        if not re.search(r"\d", paon) and epc_street:
            m_num = re.match(r"^(\d+\w*)", epc_street.strip())
            if m_num:
                paon_alts.append(m_num.group(1))

    # "flat-as-PAON": EPC gives saon=None, paon=flat_number (e.g. "100").
    # LR may store this inverted: saon=flat_number, paon=building_name.
    # Happens when EPC address1 = "100 BELVEDERE ROW APARTMENTS" — the parser
    # sees no SAON keyword so it extracts "100" as PAON and loses the building name.
    flat_as_paon = bool(saon is None and paon and re.match(r"^\d+\w*$", paon.strip()))

    sales = []
    for b in bindings:
        row_paon   = b.get("paon",   {}).get("value", "").strip().upper()
        row_saon   = b.get("saon",   {}).get("value", "").strip().upper()
        row_street = b.get("street", {}).get("value", "").strip().upper()

        # Street filter — only apply when both sides are populated
        if epc_street_norm and row_street:
            if _normalise_street(row_street) != epc_street_norm:
                continue

        # "flat-as-PAON" match: LR has saon=flat_number, paon=building_name.
        # Detected when EPC flat number (our paon) matches LR saon, and LR paon
        # is a non-numeric building name (not another flat/house number).
        # row_saon may be "105" or "APARTMENT 105" — use _saon_num for the latter.
        if (flat_as_paon
                and (row_saon == paon.upper() or _saon_num(row_saon) == paon.upper())
                and row_paon and not re.match(r"^\d", row_paon)):
            sales.append(_format_sale(b))
            continue

        # Standard PAON filter — try all alternatives (building name AND street number)
        if paon_alts and not any(_paon_match(p, row_paon) for p in paon_alts):
            continue

        # SAON filter — try exact match first, then numeric-only fallback
        # (LR sometimes stores "38" while EPC gives "FLAT 38")
        if saon:
            if row_saon != saon.upper() and _saon_num(row_saon) != _saon_num(saon):
                continue
        else:
            # House query: exclude records that belong to a sub-unit.
            # Skip this exclusion for flat-as-PAON properties — handled above.
            if row_saon and not flat_as_paon:
                continue

        sales.append(_format_sale(b))

    return sales  # already ORDER BY DESC(?date) from SPARQL


# ---------------------------------------------------------------------------
# Async HTTP fetchers (run concurrently)
# ---------------------------------------------------------------------------

async def _fetch_epc_from_cert_page(cert_url: str) -> dict | None:
    """Scrape EPC data from the GOV.UK find-energy-certificate page.

    Used when the EPC open-data API doesn't have the property's record (the RRN
    used in find-energy-certificate.service.gov.uk URLs is NOT the same identifier
    as the open-data API's lmk-key — they are different systems).

    The GOV.UK page uses narrative/paragraph HTML, not <dt>/<dd> lists.
    Returns a partial dict using the same field names as the EPC open-data API.
    Missing fields are absent; callers use .get() so they receive None.
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                cert_url,
                headers={"User-Agent": "PropVal/1.0 (propval.co.uk)"},
                follow_redirects=True,
            )
        if resp.status_code != 200:
            print(f"DEBUG: cert page scrape status {resp.status_code}")
            return None

        html = resp.text
        # Strip tags helper
        def _t(s: str) -> str:
            return re.sub(r"<[^>]+>", "", s).strip()

        result: dict = {}

        # ── Energy rating band (A–G) ──────────────────────────────────────────
        # Appears as "Band B" or "current energy rating is B" or inside an SVG/span
        for pat in [
            r'[Bb]and\s+([A-G])\b',
            r'current energy rating[^A-Z]{0,40}([A-G])\b',
            r'epc-rating[^>]*>([A-G])<',
            r'rating-current[^>]*>([A-G])<',
        ]:
            m = re.search(pat, html)
            if m:
                result["current-energy-rating"] = m.group(1).upper()
                break

        # ── Energy score (numeric, 1–100) ─────────────────────────────────────
        # Appears near the band letter: "86" or "Current score: 86"
        for pat in [
            r'[Cc]urrent\s+(?:energy\s+)?(?:efficiency\s+)?score[^>]*?(\d{1,3})',
            r'energy efficiency score[^0-9]{0,30}(\d{1,3})',
            r'(?:score|rating)[^0-9]{0,20}(\d{2,3})\b',
        ]:
            m = re.search(pat, html, re.IGNORECASE)
            if m:
                score = int(m.group(1))
                if 1 <= score <= 100:
                    result["current-energy-efficiency"] = score
                    break

        # ── Floor area ────────────────────────────────────────────────────────
        m = re.search(r'([\d.]+)\s*square\s+met', html, re.IGNORECASE)
        if m:
            result["total-floor-area"] = float(m.group(1))

        # ── Inspection / assessment date ──────────────────────────────────────
        for pat in [
            r'[Aa]ssessment\s+[Dd]ate[^>]*?>\s*([^<]{8,25})',
            r'[Ii]nspection\s+[Dd]ate[^>]*?>\s*([^<]{8,25})',
            r'[Vv]alid\s+until.*?([A-Z][a-z]+ \d{4})',    # "Valid until January 2028" → back-calc
        ]:
            m = re.search(pat, html, re.DOTALL)
            if m:
                raw_date = _t(m.group(1)).strip(" \n,.")
                # Try to parse "11 January 2018" → "2018-01-11"
                try:
                    dt = datetime.strptime(raw_date, "%d %B %Y")
                    result["inspection-date"] = dt.strftime("%Y-%m-%d")
                    break
                except ValueError:
                    # Keep raw string if parse fails
                    if len(raw_date) >= 4:
                        result["inspection-date"] = raw_date
                    break

        # ── Property type / built form ────────────────────────────────────────
        # The page text often says "Mid-floor flat", "Semi-detached house", etc.
        _BUILT_FORMS = [
            "Mid-floor flat", "Top-floor flat", "Ground-floor flat",
            "Mid-terrace house", "End-terrace house",
            "Semi-detached house", "Detached house",
            "Enclosed mid-terrace house", "Enclosed end-terrace house",
        ]
        for bf in _BUILT_FORMS:
            if bf.lower() in html.lower():
                result["built-form"] = bf
                # Infer property type
                result["property-type"] = "Flat" if "flat" in bf.lower() else "House"
                break

        # ── Main heating fuel ─────────────────────────────────────────────────
        for pat in [
            r'[Mm]ain\s+(?:heating\s+)?fuel[^>]*?>\s*([^<]{3,40})',
            r'[Hh]eating[^>]*?>\s*(mains gas|electric|oil|LPG|solid fuel|biomass)[^<]*<',
        ]:
            m = re.search(pat, html, re.IGNORECASE)
            if m:
                result["main-fuel"] = _t(m.group(1)).strip(" :")
                break

        # ── Habitable rooms ───────────────────────────────────────────────────
        m = re.search(r'[Hh]abitable\s+rooms?[^>]*?>\s*(\d+)', html)
        if m:
            result["number-habitable-rooms"] = int(m.group(1))

        # ── Construction age band ─────────────────────────────────────────────
        m = re.search(
            r'[Cc]onstruction\s+(?:age|date|era)[^>]*?>\s*([^<]{5,50})',
            html, re.DOTALL,
        )
        if m:
            result["construction-age-band"] = _t(m.group(1)).strip(" :")

        # ── Derive rating from score if letter not found ──────────────────────
        if "current-energy-rating" not in result and "current-energy-efficiency" in result:
            score = result["current-energy-efficiency"]
            for letter, min_sc in [("A",92),("B",81),("C",69),("D",55),("E",39),("F",21),("G",1)]:
                if score >= min_sc:
                    result["current-energy-rating"] = letter
                    break

        if result:
            print(f"DEBUG: cert page scrape OK — fields={list(result.keys())}")
        else:
            print("DEBUG: cert page scrape — no fields extracted")
        return result or None

    except Exception:
        logging.exception("_fetch_epc_from_cert_page failed for %s", cert_url)
        return None


async def _fetch_epc_rows(postcode: str, email: str, api_key: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            EPC_API_BASE,
            params={"postcode": postcode, "size": 5000},
            auth=(email, api_key),
            headers={"Accept": "application/json"},
        )
    print(f"DEBUG: EPC status={resp.status_code}")
    if resp.status_code == 401:
        raise HTTPException(status_code=502, detail="EPC API authentication failed.")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"EPC API returned {resp.status_code}.")
    return resp.json().get("rows", [])


async def _fetch_sparql_bindings(postcode: str) -> list[dict]:
    pc = normalise_postcode(postcode)
    sparql = f"""
PREFIX lrppi: <http://landregistry.data.gov.uk/def/ppi/>
PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>

SELECT ?date ?amount ?estateType ?propertyType ?newBuild ?paon ?saon ?street
WHERE {{
  ?transaction a lrppi:TransactionRecord ;
    lrppi:pricePaid ?amount ;
    lrppi:transactionDate ?date ;
    lrppi:propertyAddress ?addr .

  ?addr lrcommon:postcode "{pc}" .

  OPTIONAL {{ ?addr lrcommon:paon ?paon }}
  OPTIONAL {{ ?addr lrcommon:saon ?saon }}
  OPTIONAL {{ ?addr lrcommon:street ?street }}
  OPTIONAL {{ ?transaction lrppi:estateType ?estateType }}
  OPTIONAL {{ ?transaction lrppi:propertyType ?propertyType }}
  OPTIONAL {{ ?transaction lrppi:newBuild ?newBuild }}
}}
ORDER BY DESC(?date)
"""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            SPARQL_ENDPOINT,
            params={"query": sparql, "output": "json"},
            headers={"Accept": "application/sparql-results+json"},
        )
    print(f"DEBUG: Land Registry SPARQL status={resp.status_code}, postcode={pc}")
    if resp.status_code != 200:
        return []
    return resp.json().get("results", {}).get("bindings", [])



_HPI_REST_BASE = "https://landregistry.data.gov.uk/data/ukhpi/region"


def _hpi_slug(admin_district: str) -> str:
    """Convert admin district name to HMLR HPI REST slug.
    'Hammersmith And Fulham' → 'hammersmith-and-fulham'
    """
    return re.sub(r"\s+", "-", admin_district.strip().lower())


async def _fetch_hpi(admin_district: str | None, property_type: str | None, built_form: str | None = None) -> dict | None:
    """Fetch HMLR UK House Price Index data for a local authority.

    Uses the REST API (one request per month in parallel) rather than SPARQL
    to avoid uncertainty around ukhpi:refMonth type (URI vs xsd:date literal).

    Fetches the past 36 months (3 years); returns trend + current-month summary.
    property_type: EPC string e.g. "Flat", "House" — selects the HPI sub-series.
    """
    if not admin_district:
        return None

    slug = _hpi_slug(admin_district)
    today = datetime.now()

    # Build list of (year, month) tuples for the past 36 months
    months: list[tuple[int, int]] = []
    y, mo = today.year, today.month
    for _ in range(36):
        months.append((y, mo))
        mo -= 1
        if mo == 0:
            mo = 12
            y -= 1
    months.reverse()  # oldest first

    # Limit concurrency to avoid throttling (HMLR REST API rejects bursts)
    sem = asyncio.Semaphore(8)

    async def _fetch_month(year: int, month: int) -> dict | None:
        url = f"{_HPI_REST_BASE}/{slug}/month/{year}-{month:02d}.json"
        try:
            async with sem:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.get(url, headers={"Accept": "application/json"})
            if resp.status_code != 200:
                return None
            topic = resp.json().get("result", {}).get("primaryTopic", {})
            if not topic:
                return None

            def _fv(key: str) -> float | None:
                v = topic.get(key)
                try:
                    return float(v) if v is not None else None
                except (ValueError, TypeError):
                    return None

            return {
                "month":                   f"{year}-{month:02d}",
                "avg_price":               _fv("averagePrice"),
                "avg_price_flat":          _fv("averagePriceFlatMaisonette"),
                "avg_price_detached":      _fv("averagePriceDetached"),
                "avg_price_semi":          _fv("averagePriceSemiDetached"),
                "avg_price_terraced":      _fv("averagePriceTerraced"),
                "annual_change_pct":       _fv("percentageAnnualChange"),
                "monthly_change_pct":      _fv("percentageChange"),
                "annual_change_flat_pct":  _fv("percentageAnnualChangeFlatMaisonette"),
                "annual_change_detached_pct": _fv("percentageAnnualChangeDetached"),
                "annual_change_semi_pct":  _fv("percentageAnnualChangeSemiDetached"),
                "annual_change_terraced_pct": _fv("percentageAnnualChangeTerraced"),
                "sales_volume":            int(topic["salesVolume"]) if topic.get("salesVolume") is not None else None,
                # HPI index values — rebased to 100 at Jan 2023
                "hpi_all":      _fv("housePriceIndex"),
                "hpi_detached": _fv("housePriceIndexDetached"),
                "hpi_semi":     _fv("housePriceIndexSemiDetached"),
                "hpi_terraced": _fv("housePriceIndexTerraced"),
                "hpi_flat":     _fv("housePriceIndexFlatMaisonette"),
            }
        except Exception:
            return None

    results = await asyncio.gather(*[_fetch_month(y, mo) for y, mo in months])
    trend = [r for r in results if r is not None and r.get("avg_price") is not None]

    if not trend:
        print(f"DEBUG: HPI — no data for slug='{slug}'")
        return None

    latest = trend[-1]
    pt = (property_type or "").lower()
    bf = (built_form or "").lower()
    current_type_price = (
        latest["avg_price_flat"]     if "flat" in pt or "maisonette" in pt else
        latest["avg_price_semi"]     if "semi" in pt or "semi" in bf else
        latest["avg_price_detached"] if "detach" in pt or "detach" in bf else
        latest["avg_price_terraced"] if "terrace" in pt or "terrace" in bf else
        None
    )

    print(f"DEBUG: HPI — {admin_district} {latest['month']} avg=£{latest['avg_price']:,.0f} "
          f"annual={latest['annual_change_pct']}% points={len(trend)}")

    return {
        "local_authority":   admin_district,
        "data_month":        latest["month"],
        "avg_price":         latest["avg_price"],
        "avg_price_type":    current_type_price,
        "annual_change_pct": latest["annual_change_pct"],
        "monthly_change_pct":latest["monthly_change_pct"],
        "sales_volume":      latest["sales_volume"],
        "trend":             trend,
    }


async def _fetch_location(address: str, postcode: str) -> dict:
    """Return lat/lon + admin metadata.

    Coordinates: Nominatim (address-level precision), falling back to the
    postcodes.io centroid. Admin metadata (district, region, LSOA) always
    comes from postcodes.io.
    """
    pc = normalise_postcode(postcode)

    async def _nominatim() -> tuple[float, float] | None:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    NOMINATIM_URL,
                    params={"q": pc, "format": "json", "limit": 1, "countrycodes": "gb"},
                    headers={"User-Agent": "PropVal/1.0 (propval.co.uk)"},
                )
            if resp.status_code == 200 and resp.json():
                hit = resp.json()[0]
                return float(hit["lat"]), float(hit["lon"])
        except Exception:
            pass
        return None

    async def _postcodes_io() -> dict:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(f"{POSTCODES_IO_URL}/{pc.replace(' ', '')}")
            if resp.status_code == 200:
                return resp.json().get("result") or {}
        except Exception:
            pass
        return {}

    nom_result, pc_result = await asyncio.gather(_nominatim(), _postcodes_io())

    print(f"DEBUG: Nominatim={'ok' if nom_result else 'miss'}, postcodes.io={'ok' if pc_result else 'miss'}")

    if nom_result:
        lat, lon = nom_result
        coord_source = "nominatim"
    elif pc_result.get("latitude"):
        lat, lon = pc_result["latitude"], pc_result["longitude"]
        coord_source = "postcodes.io"
    else:
        lat = lon = None
        coord_source = None

    return {
        "lat": lat,
        "lon": lon,
        "coord_source": coord_source,
        "admin_district": pc_result.get("admin_district"),
        "region": pc_result.get("region"),
        "lsoa": pc_result.get("lsoa"),
    }


def _latlon_to_bng(lat: float, lon: float) -> tuple[int, int]:
    """Convert WGS84 lat/lon to British National Grid (easting, northing)."""
    a, b = 6378137.0, 6356752.3141
    F0 = 0.9996012717
    lat0, lon0 = math.radians(49), math.radians(-2)
    N0, E0 = -100000, 400000
    e2 = 1 - (b / a) ** 2
    n = (a - b) / (a + b)
    lat_r, lon_r = math.radians(lat), math.radians(lon)
    sl, cl, tl = math.sin(lat_r), math.cos(lat_r), math.tan(lat_r)
    nu   = a * F0 / math.sqrt(1 - e2 * sl ** 2)
    rho  = a * F0 * (1 - e2) / (1 - e2 * sl ** 2) ** 1.5
    eta2 = nu / rho - 1
    M = b * F0 * (
        (1 + n + 5/4 * n**2 + 5/4 * n**3) * (lat_r - lat0)
        - (3*n + 3*n**2 + 21/8 * n**3) * math.sin(lat_r - lat0) * math.cos(lat_r + lat0)
        + (15/8 * n**2 + 15/8 * n**3) * math.sin(2*(lat_r - lat0)) * math.cos(2*(lat_r + lat0))
        - 35/24 * n**3 * math.sin(3*(lat_r - lat0)) * math.cos(3*(lat_r + lat0))
    )
    dl = lon_r - lon0
    IV  = nu * cl
    V   = nu / 6 * cl**3 * (nu / rho - tl**2)
    VI  = nu / 120 * cl**5 * (5 - 18*tl**2 + tl**4 + 14*eta2 - 58*tl**2*eta2)
    I_  = M + N0
    II_ = nu / 2 * sl * cl
    III_= nu / 24 * sl * cl**3 * (5 - tl**2 + 9*eta2)
    IIIA= nu / 720 * sl * cl**5 * (61 - 58*tl**2 + tl**4)
    northing = int(I_ + II_*dl**2 + III_*dl**4 + IIIA*dl**6)
    easting  = int(E0 + IV*dl + V*dl**3 + VI*dl**5)
    return easting, northing


async def _fetch_flood_risk(lat: float | None, lon: float | None) -> dict:
    """Query EA Defra Open Data ArcGIS layers for long-term flood risk.

    Rivers & Sea: single point query → prob_4band (High/Medium/Low/Very Low).
    Surface Water: three probability-threshold layers queried in parallel with a
    50 m bounding-box buffer (needed because raster pixels are ~2–4 m polygons).
    Risk band derived as: ≥3.3% pa = High, ≥1% = Medium, ≥0.1% = Low, else Very Low.
    All layers use British National Grid (EPSG:27700) coordinates.
    """
    if lat is None or lon is None:
        return {"rivers_sea_risk": None, "surface_water_risk": None}

    easting, northing = _latlon_to_bng(lat, lon)

    async def _rs_risk() -> str:
        """NaFRA2 (Jan 2025) rivers & sea risk via environment.data.gov.uk WMS."""
        bbox = f"{easting},{northing},{easting + 1},{northing + 1}"
        params = {
            "SERVICE": "WMS",
            "VERSION": "1.3.0",
            "REQUEST": "GetFeatureInfo",
            "LAYERS": "rofrs_4band",
            "QUERY_LAYERS": "rofrs_4band",
            "CRS": "EPSG:27700",
            "BBOX": bbox,
            "WIDTH": "3",
            "HEIGHT": "3",
            "I": "1",
            "J": "1",
            "INFO_FORMAT": "application/json",
        }
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(NAFRA2_RS_WMS, params=params)
            if resp.status_code != 200:
                return None
            features = resp.json().get("features", [])
            if not features:
                return "Very Low"
            return str(features[0]["properties"].get("risk_band", "Very Low")).strip()
        except Exception:
            return None

    async def _sw_in_zone(url: str) -> bool:
        """Return True if the property point falls within this SW flood extent layer."""
        params = {
            "geometry": f"{easting},{northing}",
            "geometryType": "esriGeometryPoint",
            "inSR": "27700",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "objectid",
            "returnGeometry": "false",
            "f": "json",
        }
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(url, params=params)
            if resp.status_code != 200:
                return False
            return len(resp.json().get("features", [])) > 0
        except Exception:
            return False

    rs_risk, sw_30, sw_100, sw_1000 = await asyncio.gather(
        _rs_risk(),
        _sw_in_zone(EA_ROFSW_1IN30_URL),
        _sw_in_zone(EA_ROFSW_1IN100_URL),
        _sw_in_zone(EA_ROFSW_1IN1000_URL),
    )

    if sw_30:
        sw_risk = "High"
    elif sw_100:
        sw_risk = "Medium"
    elif sw_1000:
        sw_risk = "Low"
    else:
        sw_risk = "Very Low"

    print(f"DEBUG: flood risk — rivers_sea={rs_risk}, surface_water={sw_risk}")
    return {"rivers_sea_risk": rs_risk, "surface_water_risk": sw_risk}


async def _fetch_listed_buildings(lat: float | None, lon: float | None) -> list[dict]:
    """Return listed buildings within 75 m of the property from Historic England NHLE.

    Uses a buffered point query on the ArcGIS Online public FeatureServer.
    Results include name, grade, list entry number, and a link to the HE record.
    """
    if lat is None or lon is None:
        return []
    params = {
        "geometry": f"{lon},{lat}",
        "geometryType": "esriGeometryPoint",
        "inSR": "4326",
        "distance": "75",
        "units": "esriSRUnit_Meter",
        "outFields": "ListEntry,Name,Grade,hyperlink",
        "returnGeometry": "false",
        "orderByFields": "Grade ASC",
        "f": "json",
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(NHLE_URL, params=params)
        if resp.status_code != 200:
            return []
        features = resp.json().get("features", [])
        results = []
        for feat in features:
            a = feat.get("attributes", {})
            if not a.get("Name"):
                continue
            results.append({
                "list_entry": a.get("ListEntry"),
                "name": a.get("Name", "").title(),
                "grade": a.get("Grade", ""),
                "url": a.get("hyperlink", ""),
            })
        print(f"DEBUG: listed buildings within 75m = {len(results)}")
        return results
    except Exception:
        logging.exception("_fetch_listed_buildings failed for lat=%s lon=%s", lat, lon)
        return []


async def _fetch_planning_flood_zone(lat: float | None, lon: float | None) -> str | None:
    """Return the highest statutory planning flood zone at the property (Zone 1/2/3).

    Queries planning.data.gov.uk flood-risk-zone dataset which holds the EA's
    statutory flood zones used in planning decisions. These are undefended flood
    extents (do not account for flood defences), used by mortgage lenders and
    local planning authorities.

    Zone 1 = <0.1% annual probability (default if no zones intersect)
    Zone 2 = 0.1–1% annual probability (medium probability)
    Zone 3 = >1% annual probability (high probability; includes 3b functional floodplain)
    """
    if lat is None or lon is None:
        return None
    params = {
        "dataset": "flood-risk-zone",
        "geometry": f"POINT({lon} {lat})",
        "geometry_relation": "intersects",
        "fields": "flood-risk-level,flood-risk-type",
        "limit": "20",
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(PLANNING_DATA_URL, params=params)
        if resp.status_code != 200:
            return None
        entities = resp.json().get("entities", [])
        if not entities:
            return "Zone 1"  # default: most of England is Zone 1
        levels = []
        for e in entities:
            lvl = e.get("flood-risk-level", "")
            if lvl in ("2", "3"):
                levels.append(int(lvl))
        highest = max(levels) if levels else 1
        return f"Zone {highest}"
    except Exception:
        logging.exception("_fetch_planning_flood_zone failed for lat=%s lon=%s", lat, lon)
        return None


async def _fetch_natural_england(lat: float | None, lon: float | None) -> dict:
    """Query Natural England designated sites at/near the property.

    Uses the Natural England ArcGIS Online FeatureServer (public, no auth).
    All spatial queries use BNG envelope (EPSG:27700) via POST.

    Buffers:
      SSSI           2 000 m  — large areas; "SSSIs within 2 km"
      AONB/Nat. Landscape 100 m  — effectively point-in-polygon for large polygons
      Ancient Woodland    50 m  — tight; "ancient woodland within 50 m"
      Green Belt          —    — Shapely point-in-polygon on startup-loaded GeoJSON
    """
    if lat is None or lon is None:
        return {"sssi": [], "aonb": None, "ancient_woodland": [], "green_belt": False}

    easting, northing = _latlon_to_bng(lat, lon)

    async def _ne_post(url: str, buffer: int, fields: str) -> list[dict]:
        data = {
            "geometry": f"{easting - buffer},{northing - buffer},{easting + buffer},{northing + buffer}",
            "geometryType": "esriGeometryEnvelope",
            "inSR": "27700",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": fields,
            "returnGeometry": "false",
            "f": "json",
        }
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(url, data=data)
            if resp.status_code != 200:
                return []
            return resp.json().get("features", [])
        except Exception:
            return []

    def _green_belt() -> bool:
        """Point-in-polygon check using pre-loaded Shapely geometries.

        Replaces the planning.data.gov.uk runtime API call which has a known
        intermittent false-positive bug in its server-side geometry engine.
        """
        if not _green_belt_polygons:
            return False  # GeoJSON failed to load at startup
        pt = Point(lon, lat)
        return any(geom.contains(pt) for _, geom in _green_belt_polygons)

    sssi_feats, aonb_feats, aw_feats = await asyncio.gather(
        _ne_post(NE_SSSI_URL, 2000, "NAME"),
        _ne_post(NE_AONB_URL, 100, "NAME,DESIG_DATE"),
        _ne_post(NE_AW_URL, 50, "NAME,STATUS"),
    )
    in_green_belt = _green_belt()

    # SSSI — unique names, drop empty
    sssi_names = list(dict.fromkeys(
        f["attributes"]["NAME"] for f in sssi_feats
        if f.get("attributes", {}).get("NAME")
    ))

    # AONB — first match (property can only be in one AONB)
    aonb_name = None
    if aonb_feats:
        raw = aonb_feats[0]["attributes"].get("NAME", "")
        aonb_name = raw.title() if raw else None

    # Ancient Woodland — deduplicate by name, keep highest-significance STATUS
    _STATUS_RANK = {"ASNW": 2, "PAWS": 1}
    aw_by_name: dict[str, str] = {}
    for f in aw_feats:
        attrs = f.get("attributes", {})
        name = (attrs.get("NAME") or "").title().strip()
        status = attrs.get("STATUS", "")
        if not name:
            continue
        if name not in aw_by_name or _STATUS_RANK.get(status, 0) > _STATUS_RANK.get(aw_by_name[name], 0):
            aw_by_name[name] = status
    aw_list = [{"name": name, "type": status} for name, status in aw_by_name.items()]

    print(f"DEBUG: NE — sssi={len(sssi_names)}, aonb={aonb_name}, aw={len(aw_list)}, green_belt={in_green_belt}")
    return {
        "sssi": sssi_names,
        "aonb": aonb_name,
        "ancient_woodland": aw_list,
        "green_belt": in_green_belt,
    }


async def _fetch_conservation_areas(lat: float | None, lon: float | None) -> list[dict]:
    """Return conservation areas whose polygon contains the property.

    Uses planning.data.gov.uk geometry-intersects query on the conservation-area dataset.
    """
    if lat is None or lon is None:
        return []
    params = {
        "dataset": "conservation-area",
        "geometry": f"POINT({lon} {lat})",
        "geometry_relation": "intersects",
        "limit": "10",
        "fields": "name,reference,designation-date,documentation-url",
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(PLANNING_DATA_URL, params=params)
        if resp.status_code != 200:
            return []
        entities = resp.json().get("entities", [])
        results = []
        for e in entities:
            name = e.get("name", "").strip()
            if not name:
                continue
            results.append({
                "name": name,
                "reference": e.get("reference", ""),
                "designation_date": e.get("designation-date", ""),
                "documentation_url": e.get("documentation-url", ""),
            })
        print(f"DEBUG: conservation areas = {len(results)}")
        return results
    except Exception:
        logging.exception("_fetch_conservation_areas failed for lat=%s lon=%s", lat, lon)
        return []


async def _fetch_brownfield(lat: float | None, lon: float | None) -> list[dict]:
    """Return brownfield land sites within ~500 m of the property.

    Uses a WGS84 bounding-box polygon on planning.data.gov.uk brownfield-land
    dataset. Returns name, hectares, planning status, and hazardous-substances flag.
    """
    if lat is None or lon is None:
        return []
    # ~100 m bounding box in WGS84 degrees (UK latitudes)
    d_lat, d_lon = 0.0009, 0.0012
    bbox = (
        f"POLYGON(({lon-d_lon} {lat-d_lat},"
        f"{lon+d_lon} {lat-d_lat},"
        f"{lon+d_lon} {lat+d_lat},"
        f"{lon-d_lon} {lat+d_lat},"
        f"{lon-d_lon} {lat-d_lat}))"
    )
    params = {
        "dataset": "brownfield-land",
        "geometry": bbox,
        "geometry_relation": "intersects",
        "limit": "10",
        "fields": "name,reference,site-address,hectares,ownership-status,planning-permission-status,planning-permission-type,planning-permission-date,hazardous-substances,notes",
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(PLANNING_DATA_URL, params=params)
        if resp.status_code != 200:
            return []
        entities = resp.json().get("entities", [])
        results = []
        for e in entities:
            site_name = (e.get("name") or e.get("site-address") or e.get("reference") or "").strip()
            if not site_name:
                continue
            results.append({
                "name": site_name,
                "hectares": e.get("hectares"),
                "ownership_status": e.get("ownership-status"),
                "planning_status": e.get("planning-permission-status"),
                "planning_type": e.get("planning-permission-type"),
                "planning_date": e.get("planning-permission-date"),
                "hazardous_substances": e.get("hazardous-substances") == "yes",
            })
        print(f"DEBUG: brownfield sites within 100m = {len(results)}")
        return results
    except Exception:
        logging.exception("_fetch_brownfield failed for lat=%s lon=%s", lat, lon)
        return []


async def _fetch_coal_mining_risk(lat: float | None, lon: float | None) -> dict:
    """Return coal mining risk at the property using the Coal Authority WMS.

    Queries the Development High Risk Area (layer 0) and Coal Mining Reporting Area
    (layer 3) via WMS GetFeatureInfo on the BGS-hosted Coal Authority service.
    Uses BNG (EPSG:27700) with a 1 m × 1 m bounding box — same pattern as NaFRA2.

    Returns:
        high_risk        — True if property is in a Development High Risk Area
        in_coalfield     — True if property is within any Coal Mining Reporting Area
    """
    if lat is None or lon is None:
        return {"high_risk": False, "in_coalfield": False}

    easting, northing = _latlon_to_bng(lat, lon)
    bbox = f"{easting},{northing},{easting + 1},{northing + 1}"

    async def _wms_query(layer: str) -> bool:
        params = {
            "SERVICE": "WMS",
            "VERSION": "1.3.0",
            "REQUEST": "GetFeatureInfo",
            "LAYERS": layer,
            "QUERY_LAYERS": layer,
            "CRS": "EPSG:27700",
            "BBOX": bbox,
            "WIDTH": "3",
            "HEIGHT": "3",
            "I": "1",
            "J": "1",
            "INFO_FORMAT": "text/html",
        }
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(COAL_AUTHORITY_WMS, params=params)
            if resp.status_code != 200:
                return False
            text = resp.text
            # ArcGIS WMS returns "No results" or an empty table when no features found
            no_result_phrases = ["no results", "no features", "0 features", "no records"]
            if any(p in text.lower() for p in no_result_phrases):
                return False
            # A populated feature response contains attribute table rows
            return "attrValue" in text or "attrName" in text or "FEATURE_TYPE" in text
        except Exception:
            return False

    high_risk, in_coalfield = await asyncio.gather(
        _wms_query("Development.High.Risk.Area"),
        _wms_query("Coal.Mining.Reporting.Area"),
    )

    print(f"DEBUG: coal mining — high_risk={high_risk}, in_coalfield={in_coalfield}")
    return {"high_risk": high_risk, "in_coalfield": in_coalfield}


async def _fetch_radon_risk(lat: float | None, lon: float | None) -> str | None:
    """Return the radon risk category at the property from the BGS WMS.

    Uses the same BGS host and GetFeatureInfo pattern as _fetch_coal_mining_risk.
    Layer: Radon.1km (1 km grid, UKHSA + BGS joint dataset, updated Oct 2025).
    Returns one of: "Lower", "Intermediate", "Intermediate-High", "High",
    "Very High", or None if outside mapped area / request fails.
    """
    if lat is None or lon is None:
        return None

    easting, northing = _latlon_to_bng(lat, lon)
    bbox = f"{easting},{northing},{easting + 1},{northing + 1}"
    params = {
        "SERVICE": "WMS",
        "VERSION": "1.3.0",
        "REQUEST": "GetFeatureInfo",
        "LAYERS": "Radon.1km",
        "QUERY_LAYERS": "Radon.1km",
        "CRS": "EPSG:27700",
        "BBOX": bbox,
        "WIDTH": "3",
        "HEIGHT": "3",
        "I": "1",
        "J": "1",
        "INFO_FORMAT": "text/html",
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(BGS_RADON_WMS, params=params)
        if resp.status_code != 200:
            return None
        text = resp.text
        # No features = outside mapped area
        no_result_phrases = ["no results", "no features", "0 features", "no records"]
        if any(p in text.lower() for p in no_result_phrases):
            return None
        # ArcGIS WMS HTML: one header row (<th>) then one data row (<td>)
        # Parse both and align by column index
        CLASS_MAP = {"1": "Lower", "2": "Intermediate", "3": "Intermediate-High",
                     "4": "High", "5": "Very High"}
        headers = re.findall(r"<th[^>]*>([^<]+)</th>", text)
        values  = re.findall(r"<td[^>]*>([^<]+)</td>", text)
        if "CLASS_MAX" in headers and values:
            col = headers.index("CLASS_MAX")
            if col < len(values):
                category = CLASS_MAP.get(values[col].strip())
                print(f"DEBUG: radon risk={category}")
                return category
        return None
    except Exception:
        logging.exception("_fetch_radon_risk failed for lat=%s lon=%s", lat, lon)
        return None


async def _fetch_ground_conditions(lat: float | None, lon: float | None) -> dict:
    """Return BGS GeoSure ground hazard classes at the property location.

    Queries six BGS hex_grids MapServer layers concurrently via ArcGIS REST
    POINT intersect. Each layer covers one GeoSure hazard at 5 km hex resolution.
    Returns CLASS value: "Low" | "Moderate" | "Significant" | "NA" | None.
    """
    if lat is None or lon is None:
        empty = {"shrink_swell": None, "landslides": None, "compressible": None,
                 "collapsible": None, "running_sand": None, "soluble_rocks": None}
        return empty

    params_base = {
        "geometry": f"{lon},{lat}",
        "geometryType": "esriGeometryPoint",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "CLASS,Legend,Advisory",
        "returnGeometry": "false",
        "f": "json",
    }

    async def _query(url: str) -> str | None:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(url, params=params_base)
            if resp.status_code != 200:
                return None
            features = resp.json().get("features", [])
            if not features:
                return None
            cls = str(features[0].get("attributes", {}).get("CLASS", "")).strip()
            return {"1": "Low", "2": "Moderate", "3": "Significant"}.get(cls)
        except Exception:
            return None

    ss, ls, cp, cl, rs, sr = await asyncio.gather(
        _query(BGS_GS_SHRINK_SWELL),
        _query(BGS_GS_LANDSLIDES),
        _query(BGS_GS_COMPRESSIBLE),
        _query(BGS_GS_COLLAPSIBLE),
        _query(BGS_GS_RUNNING_SAND),
        _query(BGS_GS_SOLUBLE_ROCKS),
    )
    result = {
        "shrink_swell":  ss,
        "landslides":    ls,
        "compressible":  cp,
        "collapsible":   cl,
        "running_sand":  rs,
        "soluble_rocks": sr,
    }
    return result


GOV_EPC_SEARCH = "https://find-energy-certificate.service.gov.uk/find-a-certificate/search-by-postcode"


async def _fetch_epc_cert_url(postcode: str, matched_address: str) -> str | None:
    """Scrape the GOV.UK EPC search page to resolve the direct certificate URL.

    The official site uses RRNs (XXXX-XXXX-XXXX-XXXX-XXXX) which the EPC Open
    Data API never exposes. We fetch the postcode search results, extract every
    (RRN, address) pair, and fuzzy-match against our already-resolved EPC address
    to find the right certificate link.
    """
    pc = normalise_postcode(postcode).replace(" ", "")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                GOV_EPC_SEARCH,
                params={"postcode": pc},
                headers={"User-Agent": "PropVal/1.0 (propval.co.uk)"},
            )
        if resp.status_code != 200:
            return None

        pairs = re.findall(
            r'href="(/energy-certificate/[\d-]+)"[^>]*>\s*([^<]+?)\s*</a>',
            resp.text,
        )
        if not pairs:
            return None

        best_path, best_score = None, 0.0
        q_num = house_number(matched_address)
        for path, cert_addr in pairs:
            fuzzy = SequenceMatcher(None, matched_address.lower(), cert_addr.lower()).ratio()
            c_num = house_number(cert_addr)
            number_match = (1.0 if q_num == c_num else 0.0) if (q_num and c_num) else fuzzy
            score = 0.5 * fuzzy + 0.5 * number_match
            if score > best_score:
                best_score, best_path = score, path

        if best_score >= 0.8 and best_path:
            print(f"DEBUG: EPC cert URL score={best_score:.3f} path={best_path}")
            return f"https://find-energy-certificate.service.gov.uk{best_path}"
    except Exception:
        logging.exception("_fetch_epc_cert_url failed for postcode=%s", postcode)
    return None


async def _fetch_lease_details(uprn: str | None) -> dict:
    """Look up lease commencement, term and expiry from the local SQLite DB.

    DB is built once by running:
        py -3.11 scripts/build_leases_db.py <LEASES_FULL_*.csv>

    Returns all-None when the DB file is absent or the UPRN is not found.
    """
    empty = {"lease_commencement": None, "lease_term_years": None, "lease_expiry_date": None}
    if not uprn:
        return empty

    db_path = Path(__file__).resolve().parent.parent / "leases.db"
    if not db_path.exists():
        return empty

    def _query():
        import sqlite3
        con = sqlite3.connect(db_path, check_same_thread=False)
        con.row_factory = sqlite3.Row
        try:
            row = con.execute(
                "SELECT date_of_lease, term_years, expiry_date "
                "FROM registered_leases WHERE uprn = ? LIMIT 1",
                (str(uprn),),
            ).fetchone()
            return dict(row) if row else None
        finally:
            con.close()

    try:
        row = await asyncio.to_thread(_query)
        if not row:
            return empty
        return {
            "lease_commencement": row["date_of_lease"],
            "lease_term_years":   row["term_years"],
            "lease_expiry_date":  row["expiry_date"],
        }
    except Exception:
        logging.exception("Lease details lookup failed for uprn=%s", uprn)
        return empty


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/search")
async def search_property(body: SearchRequest, _user: dict = Depends(get_current_user)):
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

        # Phase 1: EPC, Land Registry and coordinates — all concurrent.
        # NOTE: Land Registry linked data does not populate lrcommon:uprn on price-paid
        # records, so we cannot query by UPRN there. We always use postcode + SAON/PAON
        # filtering. The UPRN from EPC is surfaced in the response and will be used by
        # future UPRN-native APIs (Ofcom broadband, HMLR AVM, etc.).
        epc_rows, sparql_bindings, location = await asyncio.gather(
            _fetch_epc_rows(postcode, epc_email, epc_api_key),
            _fetch_sparql_bindings(postcode),
            _fetch_location(body.address, postcode),
        )

        # ── Try EPC match ──────────────────────────────────────────────────────
        epc_matched = False
        best: dict = {}
        best_match_score = 0.0
        if epc_rows:
            best = max(epc_rows, key=lambda r: combined_score(body.address, build_epc_address(r)))
            best_match_score = combined_score(body.address, build_epc_address(best))
            epc_matched = best_match_score >= 0.7

            # Belt-and-suspenders: verify house number even when score passes threshold.
            # Guards against edge-cases where street similarity is marginal but score
            # squeaked over 0.7 (e.g. very short addresses).
            if epc_matched:
                q_num = house_number(body.address)
                c_num = house_number(build_epc_address(best))
                if q_num and c_num and q_num != c_num:
                    print(f"DEBUG: Post-match house-number mismatch ({q_num} vs {c_num}) — forcing fallback")
                    epc_matched = False

        if not epc_matched:
            # ── No-EPC fallback ────────────────────────────────────────────────
            # Parse address parts directly from user input; run all spatial APIs
            # with Nominatim coordinates.  EPC-specific fields return null.
            print(f"DEBUG: No EPC match (score={best_match_score:.3f}) — no-EPC fallback for '{body.address}'")
            best = {}  # reset so all best.get() calls return None
            parts = parse_user_address_parts(body.address, postcode)
            matched_address = body.address.strip()
            inferred_building_name: str | None = None
        else:
            matched_address = build_epc_address(best)
            parts = parse_address_parts(best)
            inferred_building_name = None
            if (not parts["saon"] and parts["paon"]
                    and re.match(r"^\d+\w*$", str(parts["paon"]).strip())):
                for b in sparql_bindings:
                    lr_paon = b.get("paon", {}).get("value", "").strip().upper()
                    lr_saon = b.get("saon", {}).get("value", "").strip().upper()
                    if ((lr_saon == str(parts["paon"]).upper()
                            or _saon_num(lr_saon) == str(parts["paon"]).upper())
                            and lr_paon and not re.match(r"^\d", lr_paon)):
                        inferred_building_name = lr_paon.title()
                        break

        sales = _filter_sales(sparql_bindings, parts)
        print(f"DEBUG: matched='{matched_address}' uprn={best.get('uprn')} saon={parts['saon']} paon={parts['paon']} street={parts['street']} sales={len(sales)} inferred_building={inferred_building_name} epc_matched={epc_matched}")

        # Phase 2: spatial queries + EPC cert URL — all concurrent.
        # return_exceptions=True ensures one failing task never crashes the whole request.
        _p2 = await asyncio.gather(
            _fetch_flood_risk(location["lat"], location["lon"]),
            _fetch_planning_flood_zone(location["lat"], location["lon"]),
            _fetch_listed_buildings(location["lat"], location["lon"]),
            _fetch_conservation_areas(location["lat"], location["lon"]),
            _fetch_natural_england(location["lat"], location["lon"]),
            _fetch_epc_cert_url(postcode, matched_address),
            _fetch_council_tax_band(postcode, matched_address),
            _fetch_brownfield(location["lat"], location["lon"]),
            _fetch_coal_mining_risk(location["lat"], location["lon"]),
            _fetch_radon_risk(location["lat"], location["lon"]),
            _fetch_ground_conditions(location["lat"], location["lon"]),
            _fetch_lease_details(best.get("uprn")),
            _fetch_hpi(location["admin_district"], best.get("property-type"), best.get("built-form")),
            return_exceptions=True,
        )

        def _safe(val, default):
            if isinstance(val, BaseException):
                logging.exception("Phase 2 task failed", exc_info=val)
                return default
            return val

        flood            = _safe(_p2[0],  {"rivers_sea_risk": None, "surface_water_risk": None})
        planning_zone    = _safe(_p2[1],  None)
        listed_buildings = _safe(_p2[2],  [])
        conservation_areas = _safe(_p2[3], [])
        natural_england  = _safe(_p2[4],  {"sssi": [], "aonb": None, "ancient_woodland": [], "green_belt": False})
        epc_url          = _safe(_p2[5],  None)
        council_tax_band = _safe(_p2[6],  None)
        brownfield       = _safe(_p2[7],  [])
        coal             = _safe(_p2[8],  {"high_risk": False, "in_coalfield": False})
        radon            = _safe(_p2[9],  None)
        ground           = _safe(_p2[10], {
            "shrink_swell": None, "landslides": None, "compressible": None,
            "collapsible": None, "running_sand": None, "soluble_rocks": None,
        })
        lease_details    = _safe(_p2[11], {"lease_commencement": None, "lease_term_years": None, "lease_expiry_date": None})
        hpi              = _safe(_p2[12], None)

        # ── Phase 2.5: cert-page EPC scrape ───────────────────────────────────
        # If the postcode search didn't return this property's EPC row but the
        # GOV.UK find-energy-certificate scraper DID find a cert URL, scrape the
        # certificate page directly to recover the EPC data fields.
        # (The RRN in find-energy-certificate URLs is NOT the same identifier as
        #  the open-data API's lmk-key — a direct API lookup by RRN doesn't work.)
        if not epc_matched and epc_url:
            rrn_row = await _fetch_epc_from_cert_page(epc_url)
            if rrn_row:
                best = rrn_row
                epc_matched = True
                # Re-derive address parts from the freshly fetched EPC row.
                # The scraped dict may lack address fields, so fall back to the
                # user-parsed parts (already set in the fallback branch above).
                scraped_addr = build_epc_address(best)
                if scraped_addr.strip():
                    parts = parse_address_parts(best)
                    matched_address = scraped_addr
                    sales = _filter_sales(sparql_bindings, parts)
                # Infer building name (same logic as EPC-match branch)
                inferred_building_name = None
                if (not parts["saon"] and parts["paon"]
                        and re.match(r"^\d+\w*$", str(parts["paon"]).strip())):
                    for b in sparql_bindings:
                        lr_paon = b.get("paon", {}).get("value", "").strip().upper()
                        lr_saon = b.get("saon", {}).get("value", "").strip().upper()
                        if ((lr_saon == str(parts["paon"]).upper()
                                or _saon_num(lr_saon) == str(parts["paon"]).upper())
                                and lr_paon and not re.match(r"^\d", lr_paon)):
                            inferred_building_name = lr_paon.title()
                            break
                print(f"DEBUG: Phase 2.5 cert-page scrape — uprn={best.get('uprn')} fields={list(best.keys())}")

        return {
            "uprn": best.get("uprn"),
            "postcode": normalise_postcode(postcode),
            "address": matched_address,
            "energy_rating": best.get("current-energy-rating"),
            "energy_score": best.get("current-energy-efficiency"),
            "epc_url": epc_url,
            "property_type": best.get("property-type"),
            "built_form": best.get("built-form"),
            "building_name": inferred_building_name or (parts.get("paon") if parts.get("paon") and not re.match(r"^\d", str(parts.get("paon", ""))) else None),
            "paon_number": None if inferred_building_name else (parts.get("paon") if parts.get("paon") and re.match(r"^\d", str(parts.get("paon", ""))) else None),
            "saon": parts.get("saon"),
            "street_name": parts.get("street"),
            "floor_area_m2": best.get("total-floor-area"),
            "construction_age_band": best.get("construction-age-band"),
            "num_rooms": best.get("number-habitable-rooms"),
            "heating_type": best.get("main-fuel"),
            "inspection_date": best.get("inspection-date"),
            "council_tax_band": council_tax_band,
            "lat": location["lat"],
            "lon": location["lon"],
            "coord_source": location["coord_source"],
            "admin_district": location["admin_district"],
            "region": location["region"],
            "lsoa": location["lsoa"],
            "rivers_sea_risk": flood["rivers_sea_risk"],
            "surface_water_risk": flood["surface_water_risk"],
            "planning_flood_zone": planning_zone,
            "listed_buildings": listed_buildings,
            "conservation_areas": conservation_areas,
            "sssi": natural_england["sssi"],
            "aonb": natural_england["aonb"],
            "ancient_woodland": natural_england["ancient_woodland"],
            "green_belt": natural_england["green_belt"],
            "brownfield": brownfield,
            "coal_mining_high_risk": coal["high_risk"],
            "coal_mining_in_coalfield": coal["in_coalfield"],
            "radon_risk": radon,
            "ground_shrink_swell":  ground["shrink_swell"],
            "ground_landslides":    ground["landslides"],
            "ground_compressible":  ground["compressible"],
            "ground_collapsible":   ground["collapsible"],
            "ground_running_sand":  ground["running_sand"],
            "ground_soluble_rocks": ground["soluble_rocks"],
            "tenure": (
                sales[0]["tenure"] if sales
                else "Leasehold" if lease_details["lease_commencement"]
                else None
            ),
            "lease_commencement": lease_details["lease_commencement"],
            "lease_term_years": lease_details["lease_term_years"],
            "lease_expiry_date": lease_details["lease_expiry_date"],
            "sales": sales,
            "epc_matched": epc_matched,
            "hpi": hpi,
        }
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


_CT_SERVICE = "https://www.tax.service.gov.uk/check-council-tax-band"


def _scrape_council_tax_band(postcode: str, matched_address: str) -> str | None:
    """Scrape the GOV.UK check-council-tax-band service for the property's band.

    Runs synchronously via sync_playwright; called via asyncio.to_thread so it
    doesn't block the FastAPI event loop. Returns a single band letter (A–H)
    or None if the lookup fails.
    """
    pc = normalise_postcode(postcode).replace(" ", "")
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.set_default_timeout(10000)  # global cap on all page operations
            try:
                # Step 1 — search page: fill postcode and submit
                page.goto(_CT_SERVICE + "/search", wait_until="domcontentloaded", timeout=15000)
                page.fill("input[name='postcode']", pc)
                page.click("button:has-text('Search')")
                page.wait_for_load_state("domcontentloaded", timeout=15000)

                # Step 2 — results page: grab visible text
                content = page.inner_text("body")
            finally:
                browser.close()

        # Results page uses a tab-separated table: ADDRESS\tBAND\tLOCAL AUTHORITY
        # Parse every tab-delimited row that has a single-letter band (A–H)
        entries = re.findall(
            r"^(.+?)\t([A-H])\t.+$",
            content,
            re.MULTILINE | re.IGNORECASE,
        )
        if not entries:
            return None

        # Fuzzy-match to find our property
        best_band, best_score = None, 0.0
        q_num = house_number(matched_address)
        for addr_text, band in entries:
            score = SequenceMatcher(None, matched_address.lower(), addr_text.lower()).ratio()
            # Boost exact house-number match (same logic as EPC matching)
            if q_num and house_number(addr_text) == q_num:
                score += 0.3
            if score > best_score:
                best_score = score
                best_band = band.upper()

        print(f"DEBUG council_tax_band: best_score={best_score:.2f} band={best_band}")
        return best_band if best_score > 0.4 else None

    except Exception as exc:
        print(f"DEBUG council_tax_band: failed — {exc}")
        return None


async def _fetch_council_tax_band(postcode: str, matched_address: str) -> str | None:
    """Async wrapper: run Playwright scraper in a thread with a hard 25 s timeout."""
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_scrape_council_tax_band, postcode, matched_address),
            timeout=25.0,
        )
    except asyncio.TimeoutError:
        logging.warning("Council tax scraper timed out for postcode %s", postcode)
        return None


_EPC_CERT_BASE = "https://find-energy-certificate.service.gov.uk/energy-certificate/"


def _render_epc_pdf(print_url: str) -> bytes:
    """Render an EPC certificate page to PDF using synchronous Playwright.

    Runs in a thread via asyncio.to_thread to avoid event-loop conflicts with FastAPI.
    """
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(print_url, wait_until="networkidle", timeout=20000)
        pdf_bytes = page.pdf(
            format="A4",
            print_background=True,
            margin={"top": "15mm", "bottom": "15mm", "left": "15mm", "right": "15mm"},
        )
        browser.close()
    return pdf_bytes


@router.get("/epc-pdf")
async def download_epc_pdf(cert_url: str = Query(...), _user: dict = Depends(get_current_user)):
    if not cert_url.startswith(_EPC_CERT_BASE):
        raise HTTPException(status_code=400, detail="Invalid EPC certificate URL.")
    try:
        pdf_bytes = await asyncio.to_thread(_render_epc_pdf, cert_url + "?print=true")
        rrn = cert_url.replace(_EPC_CERT_BASE, "")
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="epc-{rrn}.pdf"'},
        )
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")


@router.get("/autocomplete")
async def autocomplete_addresses(postcode: str, _user: dict = Depends(get_current_user)):
    """Return address list for a postcode from the EPC API. Powers the search dropdown."""
    pc = extract_postcode(postcode)
    if not pc:
        return {"addresses": []}
    pc = normalise_postcode(pc)

    if pc not in _autocomplete_cache:
        email = os.getenv("EPC_EMAIL")
        api_key = os.getenv("EPC_API_KEY")
        if not email or not api_key:
            return {"addresses": []}
        try:
            rows = await _fetch_epc_rows(pc, email, api_key)
        except Exception:
            return {"addresses": []}
        _autocomplete_cache[pc] = rows
    else:
        rows = _autocomplete_cache[pc]

    seen: set[str] = set()
    addresses: list[dict] = []
    for row in rows:
        addr = build_epc_address(row)
        # Normalise for dedup: strip commas after house numbers ("41, Gander" → "41 Gander")
        dedup_key = re.sub(r"(\d),\s+", r"\1 ", addr).upper()
        if dedup_key not in seen:
            seen.add(dedup_key)
            addresses.append({"address": addr, "uprn": row.get("uprn") or ""})

    def _natural_key(item: dict) -> list:
        # Split address into text/number chunks so numeric parts sort numerically.
        # e.g. "FLAT 10 ..." → ["FLAT ", 10, " ..."] beats "FLAT 2 ..." → ["FLAT ", 2, " ..."]
        return [int(c) if c.isdigit() else c.lower() for c in re.split(r"(\d+)", item["address"])]

    addresses.sort(key=_natural_key)
    return {"addresses": addresses}
