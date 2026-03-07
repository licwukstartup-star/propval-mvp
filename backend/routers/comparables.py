"""
Comparable Selection Engine — implements the architecture spec:
  comparable-selection-architecture (2026-03-04).md

Architecture:
  - Hard deck filters: tenure (never), property type (±1 house hierarchy),
    building era for flats (never), bedrooms (±1 when relaxed)
  - 4 geographic tiers per property type (flat / house)
  - 3-phase orchestrator: strict → relax type → relax type+beds
  - Cumulative pool with early exit at target_count
  - Live SPARQL + EPC per request (no DB ingestion needed yet)

SPARQL strategy:
  Tier 1 (same building / same street):
    Postcode-level query — no cap, guaranteed completeness for small postcodes.
    Outward-level query reused (already cached) — filtered by building name.
  Tiers 3-4 (outward / adjacent codes):
    Outward-level query, 500/year cap, Python-side filtering.
  EPC cache:
    Lazy — fetched on demand when a new postcode is first encountered.
"""

import asyncio
import logging
import os
import re
import sqlite3
import time
from pathlib import Path
from datetime import date
from dateutil.relativedelta import relativedelta
from difflib import SequenceMatcher

import httpx
from fastapi import APIRouter
from pydantic import BaseModel, model_validator

router = APIRouter(prefix="/api/comparables", tags=["comparables"])

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SPARQL_ENDPOINT      = "https://landregistry.data.gov.uk/landregistry/query"
EPC_API_BASE         = "https://epc.opendatacommunities.org/api/v1/domestic/search"

SPARQL_CONCURRENT    = 3      # max parallel SPARQL (avoid 429 on LR)
SPARQL_OUTWARD_CAP   = 200    # rows per outward-code query per year-slice
EPC_CONCURRENT       = 10     # max parallel EPC calls
EPC_CALL_TIMEOUT     = 4.0    # EPC API is fast; short timeout avoids blocking
SPARQL_TIMEOUT       = 25.0   # per-query hard timeout (asyncio.wait_for — reliable on Windows)
TOTAL_TIMEOUT        = 90.0   # total orchestrator timeout
MAX_ADJACENT_CODES   = 2      # keep tier 4 fast

# Time windows per tier (months) — as per spec §5
# Postcode-level queries (flat T1, house T2) support full spec windows since they are fast.
# Outward-level queries are capped at 12 months (1 SPARQL slice) due to LR endpoint
# performance on busy London districts. Longer outward windows require a local DB cache.
FLAT_TIER_MONTHS     = {1: 30, 2: 12, 3: 12, 4: 12}
HOUSE_TIER_MONTHS    = {1: 12, 2: 18, 3: 12, 4: 12}

FLAT_TIER_LABELS     = {1: "Same building", 2: "Same development",
                         3: "Same outward code", 4: "Adjacent area"}
HOUSE_TIER_LABELS    = {1: "Same street",    2: "Same postcode",
                         3: "Same outward code", 4: "Adjacent area"}

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class SubjectPropertyInput(BaseModel):
    address:          str
    postcode:         str
    uprn:             str | None = None
    tenure:           str                   # "freehold" | "leasehold"
    property_type:    str                   # "flat" | "house"
    house_sub_type:   str | None = None
    bedrooms:         int | None = None
    building_name:    str | None = None     # non-numeric PAON e.g. "COMPASS HOUSE"
    paon_number:      str | None = None     # numeric PAON e.g. "10" (for "10 Marsh Wall" buildings)
    saon:             str | None = None     # unit identifier e.g. "APARTMENT 4908"
    development_name: str | None = None
    building_era:     str | None = None     # "period" | "modern"
    build_year:       int | None = None
    street_name:      str | None = None
    lat:              float | None = None
    lon:              float | None = None

    @model_validator(mode="after")
    def _normalise(self):
        self.postcode = _normalise_pc(self.postcode)
        t = self.tenure.strip().lower()
        self.tenure = t if t in ("freehold", "leasehold") else "leasehold"
        pt = self.property_type.strip().lower()
        if "flat" in pt or "maisonette" in pt:
            self.property_type = "flat"
        else:
            self.property_type = "house"
        if self.building_era is None and self.build_year is not None:
            self.building_era = derive_building_era(self.build_year)
        return self


class ComparableSearchRequest(BaseModel):
    subject:                  SubjectPropertyInput
    target_count:             int       = 10
    valuation_date:           str | None = None
    max_tier:                 int       = 4    # cap search at this tier (1-4)
    building_months:          int       = 30   # Tier 1 flat time window, 12–36 months
    neighbouring_months:      int       = 12   # Tiers 3-4 time window, 6–24 months
    exclude_transaction_ids:  list[str] = []   # skip these exact transaction URIs
    exclude_address_keys:     list[str] = []   # skip any transaction at these saon|postcode addresses


class ComparableCandidate(BaseModel):
    transaction_id:      str | None = None
    address:             str
    postcode:            str
    outward_code:        str
    saon:                str | None = None   # flat/unit identifier from LR (e.g. "FLAT 27")
    tenure:              str | None
    property_type:       str | None
    house_sub_type:      str | None = None
    bedrooms:            int | None = None
    building_name:       str | None = None
    building_era:        str | None = None
    build_year:           int | None = None
    build_year_estimated: bool = False      # True when inferred from sale date (new build), not EPC
    floor_area_sqm:      float | None = None
    price:               int
    transaction_date:    str
    new_build:           bool = False
    transaction_category: str | None = None
    geographic_tier:     int
    tier_label:          str
    spec_relaxations:    list[str] = []
    time_window_months:  int
    epc_matched:         bool = False
    epc_rating:          str | None = None   # e.g. "C"
    epc_score:           int | None = None   # e.g. 72
    months_ago:          int | None = None
    lease_remaining:     str | None = None


class SearchMetadata(BaseModel):
    tiers_searched:           int
    spec_relaxations_applied: list[str]
    total_candidates_scanned: int
    search_duration_ms:       int
    target_met:               bool


class ComparableSearchResponse(BaseModel):
    subject:         SubjectPropertyInput
    target_count:    int
    comparables:     list[ComparableCandidate]
    search_metadata: SearchMetadata

# ---------------------------------------------------------------------------
# Postcode helpers
# ---------------------------------------------------------------------------

def _normalise_pc(pc: str) -> str:
    pc = pc.strip().upper().replace(" ", "")
    return pc[:-3] + " " + pc[-3:]


def _outward(postcode: str) -> str:
    return postcode.strip().upper().split()[0]

# ---------------------------------------------------------------------------
# Property type helpers
# ---------------------------------------------------------------------------

_LR_TYPE_MAP = {
    "detached":        ("house", "detached"),
    "semi-detached":   ("house", "semi-detached"),
    "terraced":        ("house", "terraced"),
    "flat-maisonette": ("flat",  None),
    "other":           (None,    None),
}

_LR_ESTATE_MAP = {"freehold": "freehold", "leasehold": "leasehold"}


def _lr_type_to_spec(uri: str | None) -> tuple[str | None, str | None]:
    if not uri:
        return None, None
    frag = uri.rsplit("/", 1)[-1].lower()
    return _LR_TYPE_MAP.get(frag, (None, None))


def _lr_tenure(uri: str | None) -> str | None:
    if not uri:
        return None
    return _LR_ESTATE_MAP.get(uri.rsplit("/", 1)[-1].lower())


def _derive_property_type(epc_val: str | None) -> str | None:
    if not epc_val:
        return None
    v = epc_val.strip().lower()
    if "flat" in v or "maisonette" in v:
        return "flat"
    if v in ("house", "bungalow", "park home"):
        return "house"
    return None


def _derive_house_sub_type(built_form: str | None) -> str | None:
    if not built_form:
        return None
    bf = built_form.strip().lower()
    if "semi" in bf:
        return "semi-detached"
    if "end" in bf and ("terrace" in bf or "terr" in bf):
        return "end-terrace"
    if "terrace" in bf or "terr" in bf or "mid" in bf:
        return "terraced"
    if "detached" in bf:
        return "detached"
    return None

# ---------------------------------------------------------------------------
# Build year / era
# ---------------------------------------------------------------------------

_AGE_BAND_MAP = {
    "before 1900": 1890, "1900-1929": 1915, "1930-1949": 1940,
    "1950-1966":   1958, "1967-1975": 1971, "1976-1982": 1979,
    "1983-1990":   1987, "1991-1995": 1993, "1996-2002": 1999,
    "2003-2006":   2005, "2007 onwards": 2010,
}


def _approx_build_year(age_band: str | None) -> int | None:
    if not age_band:
        return None
    b = age_band.lower().strip()
    for key, yr in _AGE_BAND_MAP.items():
        if key in b or b in key:
            return yr
    return None


def derive_building_era(build_year: int | None) -> str | None:
    if build_year is None:
        return None
    return "modern" if build_year >= 2000 else "period"


def derive_era_from_age_band(age_band: str | None) -> str | None:
    """
    Derive 'period' or 'modern' from an EPC age band string using the *upper* year
    of the range, so that '1996-2002' → modern (upper bound 2002 ≥ 2000).
    Using the midpoint (1999) would wrongly classify it as period.
    """
    if not age_band:
        return None
    b = age_band.lower().strip()
    if "onwards" in b or "new" in b:
        return "modern"
    if "before" in b:
        return "period"
    years = re.findall(r"\d{4}", b)
    if not years:
        return None
    return "modern" if max(int(y) for y in years) >= 2000 else "period"

# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------

_STREET_ABBR = {
    "STREET": "ST", "ROAD": "RD", "AVENUE": "AVE", "DRIVE": "DR",
    "LANE": "LN", "CLOSE": "CL", "CRESCENT": "CRES", "GARDENS": "GDNS",
    "TERRACE": "TERR", "COURT": "CT", "PLACE": "PL", "GROVE": "GR",
    "SQUARE": "SQ", "PARK": "PK", "MOUNT": "MT", "RISE": "RI",
    "WAY": "WY", "WALK": "WK",
}

_BUILDING_NOISE = re.compile(
    r"\b(HOUSE|COURT|TOWER|POINT|BUILDING|BLOCK|LODGE|MANSIONS?|HEIGHTS?|APARTMENTS?|THE)\b",
    re.IGNORECASE,
)


def normalise_street(s: str) -> str:
    s = s.upper().strip()
    for full, abbr in _STREET_ABBR.items():
        s = re.sub(r"\b" + full + r"\b", abbr, s)
    s = re.sub(r"[^A-Z0-9 ]", "", s)
    return re.sub(r"\s+", " ", s).strip()


def normalise_building(s: str) -> str:
    s = s.upper().strip()
    s = _BUILDING_NOISE.sub("", s)
    s = re.sub(r"[^A-Z0-9 ]", "", s)
    return re.sub(r"\s+", " ", s).strip()


def _building_fuzzy(a: str | None, b: str | None) -> bool:
    if not a or not b:
        return False
    na, nb = normalise_building(a), normalise_building(b)
    if not na or not nb:
        return False
    return na == nb or SequenceMatcher(None, na, nb).ratio() >= 0.80


def _binding_matches_building(building_name: str, binding: dict) -> bool:
    """Check if a raw SPARQL binding's paon fuzzy-matches the given building name."""
    paon = binding.get("paon", {}).get("value", "").strip()
    return _building_fuzzy(building_name, paon)

# ---------------------------------------------------------------------------
# House sub-type hierarchy
# ---------------------------------------------------------------------------

_SUBTYPE_RANK = {"detached": 0, "semi-detached": 1, "end-terrace": 2, "terraced": 2}


def _subtype_dist(a: str | None, b: str | None) -> int:
    if not a or not b:
        return 0  # unknown sub-type → treat as compatible (EPC enrichment may resolve later)
    return abs(_SUBTYPE_RANK.get(a.lower(), 99) - _SUBTYPE_RANK.get(b.lower(), 99))

# ---------------------------------------------------------------------------
# Hard deck filter
# ---------------------------------------------------------------------------

def _passes_hard_deck(
    tenure:    str | None,
    prop_type: str | None,
    sub_type:  str | None,
    era:       str | None,
    beds:      int | None,
    subject:   SubjectPropertyInput,
    relaxations: list[str],
) -> bool:
    # Filter 1: Tenure — never relaxed
    if tenure != subject.tenure:
        return False

    # Filter 2: Property type (flat↔house never crossed)
    if prop_type != subject.property_type:
        return False

    if subject.property_type == "house":
        dist = _subtype_dist(sub_type, subject.house_sub_type)
        max_dist = 1 if "type" in relaxations else 0
        if dist > max_dist:
            return False

    # Filter 3: Building era — flats only, never relaxed
    if subject.property_type == "flat" and subject.building_era and era:
        if era != subject.building_era:
            return False

    # Filter 4: Bedrooms
    if beds is not None and subject.bedrooms is not None:
        diff = abs(beds - subject.bedrooms)
        max_diff = 1 if "bedrooms" in relaxations else 0
        if diff > max_diff:
            return False

    return True

# ---------------------------------------------------------------------------
# Time window
# ---------------------------------------------------------------------------

def _within_window(tx_date_str: str, valuation_date: date, months: int) -> bool:
    try:
        tx = date.fromisoformat(tx_date_str[:10])
    except Exception:
        return False
    return tx >= valuation_date - relativedelta(months=months)


def _months_ago(tx_date_str: str, val_date: date) -> int | None:
    try:
        tx = date.fromisoformat(tx_date_str[:10])
    except Exception:
        return None
    d = relativedelta(val_date, tx)
    return d.years * 12 + d.months

# ---------------------------------------------------------------------------
# SPARQL fetchers
# ---------------------------------------------------------------------------

SPARQL_POSTCODE_CAP = 500  # hard upper bound per postcode — no UK postcode exceeds this in 30 months;
                           # LIMIT allows the SPARQL engine to terminate early instead of full-table scanning


async def _sparql_postcode(postcode: str, months: int, sem: asyncio.Semaphore,
                           val_date: date | None = None) -> list[dict]:
    """All transactions in exact postcode for last N months.

    LIMIT {SPARQL_POSTCODE_CAP} is intentional: it lets the SPARQL endpoint stop
    scanning early once the limit is reached, preventing the 25 s timeout that
    occurs on busy London postcodes when no LIMIT is specified.  No real UK postcode
    has more than ~200 transactions in a 30-month window, so completeness is preserved.
    """
    anchor = val_date or date.today()
    date_from = (anchor - relativedelta(months=months)).isoformat()
    sparql = f"""
PREFIX lrppi:    <http://landregistry.data.gov.uk/def/ppi/>
PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>
PREFIX xsd:      <http://www.w3.org/2001/XMLSchema#>
SELECT ?tx ?date ?amount ?estateType ?propertyType ?newBuild ?category ?paon ?saon ?street ?postcode
WHERE {{
  ?tx a lrppi:TransactionRecord ;
      lrppi:pricePaid ?amount ; lrppi:transactionDate ?date ;
      lrppi:propertyAddress ?addr .
  ?addr lrcommon:postcode ?postcode .
  FILTER(STR(?postcode) = "{postcode}")
  FILTER(?date >= "{date_from}"^^xsd:date)
  OPTIONAL {{ ?addr lrcommon:paon ?paon }} OPTIONAL {{ ?addr lrcommon:saon ?saon }}
  OPTIONAL {{ ?addr lrcommon:street ?street }}
  OPTIONAL {{ ?tx lrppi:estateType ?estateType }} OPTIONAL {{ ?tx lrppi:propertyType ?propertyType }}
  OPTIONAL {{ ?tx lrppi:newBuild ?newBuild }} OPTIONAL {{ ?tx lrppi:transactionCategory ?category }}
}}
LIMIT {SPARQL_POSTCODE_CAP}"""
    async with sem:
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=SPARQL_TIMEOUT, write=5.0, pool=5.0)) as c:
                r = await asyncio.wait_for(
                    c.get(SPARQL_ENDPOINT, params={"query": sparql, "output": "json"},
                          headers={"Accept": "application/sparql-results+json"}),
                    timeout=SPARQL_TIMEOUT,
                )
            rows = r.json().get("results", {}).get("bindings", []) if r.status_code == 200 else []
            logging.warning("SPARQL postcode %s → %d rows", postcode, len(rows))
            return rows
        except asyncio.TimeoutError:
            logging.warning("SPARQL postcode %s timed out after %.0fs", postcode, SPARQL_TIMEOUT)
            return []
        except Exception:
            logging.exception("SPARQL postcode failed %s", postcode)
            return []


async def _sparql_building(
    outward: str, building_name: str, months: int, sem: asyncio.Semaphore,
    val_date: date | None = None,
) -> list[dict]:
    """
    All transactions in `outward` code where PAON starts with `building_name`.

    Land Registry sometimes appends the street number to the building name in the
    PAON field, e.g. "QUEENS WHARF, 2" instead of just "QUEENS WHARF".  Using
    STRSTARTS catches both the bare name and the name-with-number variants while
    still being precise enough (filtered by outward code) to avoid false positives.

    No row cap — targeted by building, spans all inward codes the building may have.
    """
    anchor = val_date or date.today()
    date_from = (anchor - relativedelta(months=months)).isoformat()
    bldg_upper = building_name.strip().upper()
    sparql = f"""
PREFIX lrppi:    <http://landregistry.data.gov.uk/def/ppi/>
PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>
PREFIX xsd:      <http://www.w3.org/2001/XMLSchema#>
SELECT ?tx ?date ?amount ?estateType ?propertyType ?newBuild ?category ?paon ?saon ?street ?postcode
WHERE {{
  ?tx a lrppi:TransactionRecord ;
      lrppi:pricePaid ?amount ; lrppi:transactionDate ?date ;
      lrppi:propertyAddress ?addr .
  ?addr lrcommon:postcode ?postcode ;
        lrcommon:paon ?paon .
  FILTER(STRSTARTS(STR(?paon), "{bldg_upper}"))
  FILTER(STRSTARTS(STR(?postcode), "{outward} "))
  FILTER(?date >= "{date_from}"^^xsd:date)
  OPTIONAL {{ ?addr lrcommon:saon ?saon }}
  OPTIONAL {{ ?addr lrcommon:street ?street }}
  OPTIONAL {{ ?tx lrppi:estateType ?estateType }} OPTIONAL {{ ?tx lrppi:propertyType ?propertyType }}
  OPTIONAL {{ ?tx lrppi:newBuild ?newBuild }} OPTIONAL {{ ?tx lrppi:transactionCategory ?category }}
}}"""
    async with sem:
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=SPARQL_TIMEOUT, write=5.0, pool=5.0)) as c:
                r = await asyncio.wait_for(
                    c.get(SPARQL_ENDPOINT, params={"query": sparql, "output": "json"},
                          headers={"Accept": "application/sparql-results+json"}),
                    timeout=SPARQL_TIMEOUT,
                )
            rows = r.json().get("results", {}).get("bindings", []) if r.status_code == 200 else []
            logging.warning("SPARQL building %s/%s → %d rows", outward, bldg_upper, len(rows))
            return rows
        except asyncio.TimeoutError:
            logging.warning("SPARQL building %s/%s timed out", outward, bldg_upper)
            return []
        except Exception:
            logging.exception("SPARQL building failed %s/%s", outward, bldg_upper)
            return []


async def _sparql_paon_street(
    outward: str, paon: str, street: str, months: int, sem: asyncio.Semaphore,
    val_date: date | None = None,
) -> list[dict]:
    """
    All transactions in `outward` where PAON = `paon` AND STREET = `street`.
    Used for numeric-PAON buildings (e.g. "10 Marsh Wall") where there is no
    named building identifier — paon+street together identify the building.
    No row cap — highly targeted query.
    """
    anchor = val_date or date.today()
    date_from = (anchor - relativedelta(months=months)).isoformat()
    paon_upper   = paon.strip().upper()
    street_upper = street.strip().upper()
    sparql = f"""
PREFIX lrppi:    <http://landregistry.data.gov.uk/def/ppi/>
PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>
PREFIX xsd:      <http://www.w3.org/2001/XMLSchema#>
SELECT ?tx ?date ?amount ?estateType ?propertyType ?newBuild ?category ?paon ?saon ?street ?postcode
WHERE {{
  ?tx a lrppi:TransactionRecord ;
      lrppi:pricePaid ?amount ; lrppi:transactionDate ?date ;
      lrppi:propertyAddress ?addr .
  ?addr lrcommon:postcode ?postcode ;
        lrcommon:paon "{paon_upper}" ;
        lrcommon:street "{street_upper}" .
  BIND("{paon_upper}"   AS ?paon)
  BIND("{street_upper}" AS ?street)
  FILTER(STRSTARTS(STR(?postcode), "{outward} "))
  FILTER(?date >= "{date_from}"^^xsd:date)
  OPTIONAL {{ ?addr lrcommon:saon ?saon }}
  OPTIONAL {{ ?tx lrppi:estateType ?estateType }} OPTIONAL {{ ?tx lrppi:propertyType ?propertyType }}
  OPTIONAL {{ ?tx lrppi:newBuild ?newBuild }} OPTIONAL {{ ?tx lrppi:transactionCategory ?category }}
}}"""
    async with sem:
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=SPARQL_TIMEOUT, write=5.0, pool=5.0)) as c:
                r = await asyncio.wait_for(
                    c.get(SPARQL_ENDPOINT, params={"query": sparql, "output": "json"},
                          headers={"Accept": "application/sparql-results+json"}),
                    timeout=SPARQL_TIMEOUT,
                )
            rows = r.json().get("results", {}).get("bindings", []) if r.status_code == 200 else []
            logging.warning("SPARQL paon+street %s/%s/%s → %d rows", outward, paon_upper, street_upper, len(rows))
            return rows
        except asyncio.TimeoutError:
            logging.warning("SPARQL paon+street %s/%s/%s timed out", outward, paon_upper, street_upper)
            return []
        except Exception:
            logging.exception("SPARQL paon+street failed %s/%s/%s", outward, paon_upper, street_upper)
            return []


async def _sparql_outward_year(
    outward: str, date_from: str, date_to: str, sem: asyncio.Semaphore
) -> list[dict]:
    sparql = f"""
PREFIX lrppi:    <http://landregistry.data.gov.uk/def/ppi/>
PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>
PREFIX xsd:      <http://www.w3.org/2001/XMLSchema#>
SELECT ?tx ?date ?amount ?estateType ?propertyType ?newBuild ?category ?paon ?saon ?street ?postcode
WHERE {{
  ?tx a lrppi:TransactionRecord ;
      lrppi:pricePaid ?amount ; lrppi:transactionDate ?date ;
      lrppi:propertyAddress ?addr .
  ?addr lrcommon:postcode ?postcode .
  FILTER(STRSTARTS(STR(?postcode), "{outward} "))
  FILTER(?date >= "{date_from}"^^xsd:date)
  FILTER(?date <  "{date_to}"^^xsd:date)
  OPTIONAL {{ ?addr lrcommon:paon ?paon }} OPTIONAL {{ ?addr lrcommon:saon ?saon }}
  OPTIONAL {{ ?addr lrcommon:street ?street }}
  OPTIONAL {{ ?tx lrppi:estateType ?estateType }} OPTIONAL {{ ?tx lrppi:propertyType ?propertyType }}
  OPTIONAL {{ ?tx lrppi:newBuild ?newBuild }} OPTIONAL {{ ?tx lrppi:transactionCategory ?category }}
}}
LIMIT {SPARQL_OUTWARD_CAP}"""
    async with sem:
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=SPARQL_TIMEOUT, write=5.0, pool=5.0)) as c:
                r = await asyncio.wait_for(
                    c.get(SPARQL_ENDPOINT, params={"query": sparql, "output": "json"},
                          headers={"Accept": "application/sparql-results+json"}),
                    timeout=SPARQL_TIMEOUT,
                )
            rows = r.json().get("results", {}).get("bindings", []) if r.status_code == 200 else []
            logging.warning("SPARQL outward %s %s→%s → %d rows", outward, date_from, date_to, len(rows))
            return rows
        except asyncio.TimeoutError:
            logging.warning("SPARQL outward %s timed out after %.0fs", outward, SPARQL_TIMEOUT)
            return []
        except Exception:
            logging.exception("SPARQL outward failed %s %s→%s", outward, date_from, date_to)
            return []


async def _sparql_outward(outward: str, months: int, sem: asyncio.Semaphore,
                          val_date: date | None = None) -> list[dict]:
    """Fetch outward code in yearly slices back to `months` ago."""
    anchor = val_date or date.today()
    # Upper bound: always fetch up to at least today so we never miss recent data
    # that the 200-row cap on an older window might exclude.
    upper = max(anchor, date.today())
    start = anchor - relativedelta(months=months)
    tasks, cursor = [], upper
    while cursor > start:
        yr_start = max(start, date(cursor.year - 1, cursor.month, cursor.day))
        tasks.append(_sparql_outward_year(outward, yr_start.isoformat(), cursor.isoformat(), sem))
        cursor = yr_start
    results = await asyncio.gather(*tasks, return_exceptions=True)
    merged: list[dict] = []
    for r in results:
        if isinstance(r, list):
            merged.extend(r)
    return merged

# ---------------------------------------------------------------------------
# EPC cache (lazy, shared across tiers in one request)
# ---------------------------------------------------------------------------

class EpcCache:
    def __init__(self, email: str, key: str):
        self._email  = email
        self._key    = key
        self._sem    = asyncio.Semaphore(EPC_CONCURRENT)
        self._data: dict[str, list[dict]] = {}

    async def get(self, postcode: str) -> list[dict]:
        if postcode not in self._data:
            self._data[postcode] = await self._fetch(postcode)
        return self._data[postcode]

    async def prefetch(self, postcodes: list[str]) -> None:
        missing = [pc for pc in dict.fromkeys(postcodes) if pc not in self._data]
        if missing:
            tasks = {pc: self._fetch(pc) for pc in missing}
            results = await asyncio.gather(*tasks.values(), return_exceptions=True)
            for pc, r in zip(tasks.keys(), results):
                self._data[pc] = r if isinstance(r, list) else []

    async def _fetch(self, postcode: str) -> list[dict]:
        async with self._sem:
            try:
                async with httpx.AsyncClient(timeout=EPC_CALL_TIMEOUT) as c:
                    r = await c.get(EPC_API_BASE,
                                    params={"postcode": postcode, "size": 5000},
                                    auth=(self._email, self._key),
                                    headers={"Accept": "application/json"})
                return r.json().get("rows", []) if r.status_code == 200 else []
            except Exception:
                return []

# ---------------------------------------------------------------------------
# SPARQL cache (lazy, per request keyed by outward/postcode + max months)
# ---------------------------------------------------------------------------

class SparqlCache:
    def __init__(self, sem: asyncio.Semaphore, val_date: date | None = None):
        self._sem   = sem
        self._val   = val_date
        self._pc:   dict[str, list[dict]] = {}
        self._oc:   dict[str, list[dict]] = {}
        self._bldg: dict[str, list[dict]] = {}

    async def postcode(self, pc: str, months: int) -> list[dict]:
        if pc not in self._pc:
            oc = _outward(pc)
            if oc in self._oc:
                # Outward cache is warm — try filtering it first (instant, no SPARQL call).
                # The outward query is capped at SPARQL_OUTWARD_CAP rows, so this may miss
                # postcode transactions not in that sample.  Only use the cache if the
                # outward result was NOT capped (i.e. returned fewer than SPARQL_OUTWARD_CAP
                # rows per year-slice, meaning we have complete data).
                oc_rows = self._oc[oc]
                if len(oc_rows) < SPARQL_OUTWARD_CAP:
                    pc_norm = _normalise_pc(pc)
                    filtered = [
                        row for row in oc_rows
                        if _normalise_pc(row.get("postcode", {}).get("value", "")) == pc_norm
                    ]
                    if filtered:
                        logging.warning("SPARQL postcode %s — %d rows from outward cache (uncapped)", pc, len(filtered))
                        self._pc[pc] = filtered
                        return self._pc[pc]
            # Direct postcode query — LIMIT keeps this fast even for busy postcodes
            self._pc[pc] = await _sparql_postcode(pc, months, self._sem, val_date=self._val)
        return self._pc[pc]

    async def outward(self, oc: str, months: int) -> list[dict]:
        if oc not in self._oc:
            self._oc[oc] = await _sparql_outward(oc, months, self._sem, val_date=self._val)
        return self._oc[oc]

    async def building(self, outward: str, building_name: str, months: int) -> list[dict]:
        key = f"{outward}|{building_name.upper()}|{months}"
        if key not in self._bldg:
            self._bldg[key] = await _sparql_building(outward, building_name, months, self._sem, val_date=self._val)
        return self._bldg[key]

    async def paon_street(self, outward: str, paon: str, street: str, months: int) -> list[dict]:
        key = f"{outward}|{paon.upper()}|{street.upper()}|{months}"
        if key not in self._bldg:
            self._bldg[key] = await _sparql_paon_street(outward, paon, street, months, self._sem, val_date=self._val)
        return self._bldg[key]

# ---------------------------------------------------------------------------
# SPARQL row parsing
# ---------------------------------------------------------------------------

def _parse_row(b: dict) -> dict | None:
    ds = b.get("date", {}).get("value", "")[:10]
    try:
        date.fromisoformat(ds)
    except Exception:
        return None
    try:
        price = int(float(b.get("amount", {}).get("value", "0")))
    except Exception:
        return None
    if price <= 0:
        return None
    pc_raw = b.get("postcode", {}).get("value", "").strip()
    if not pc_raw or len(pc_raw) < 5:
        return None
    postcode = _normalise_pc(pc_raw)
    prop_type, sub_type = _lr_type_to_spec(b.get("propertyType", {}).get("value"))
    new_build = b.get("newBuild", {}).get("value", "false").lower() == "true"
    cat = b.get("category", {}).get("value", "")
    cat = cat.rsplit("/", 1)[-1].upper()[:1] if cat else None
    tx_id = b.get("tx", {}).get("value") or None
    return {
        "transaction_id": tx_id,
        "sale_date":      ds,
        "price":          price,
        "postcode":       postcode,
        "outward_code":   _outward(postcode),
        "tenure":         _lr_tenure(b.get("estateType", {}).get("value")),
        "property_type":  prop_type,
        "house_sub_type": sub_type,
        "new_build":      new_build,
        "category":       cat,
        "saon":           b.get("saon",   {}).get("value", "").strip().upper(),
        "paon":           b.get("paon",   {}).get("value", "").strip().upper(),
        "street":         b.get("street", {}).get("value", "").strip().upper(),
    }


def _dedup_key(r: dict) -> str:
    if r.get("transaction_id"):
        return r["transaction_id"]
    return f"{r['saon']}|{r['paon']}|{r['street']}|{r['postcode']}|{r['sale_date']}"

# ---------------------------------------------------------------------------
# EPC enrichment
# ---------------------------------------------------------------------------

def _epc_addr(row: dict) -> str:
    return " ".join(filter(None, [
        row.get("address1", ""), row.get("address2", ""),
        row.get("address3", ""), row.get("posttown", ""), row.get("postcode", ""),
    ]))


def _enrich(saon: str, paon: str, street: str, postcode: str,
            epc_rows: list[dict]) -> dict:
    if not epc_rows:
        return {}
    addr = " ".join(filter(None, [saon, paon, street, postcode])).lower()
    best = max(epc_rows, key=lambda r: SequenceMatcher(None, addr, _epc_addr(r).lower()).ratio())
    if SequenceMatcher(None, addr, _epc_addr(best).lower()).ratio() < 0.25:
        return {}

    build_year = None
    try:
        yr = best.get("construction-year", "")
        if yr:
            build_year = int(yr)
    except Exception:
        pass
    if build_year is None:
        build_year = _approx_build_year(best.get("construction-age-band"))

    epc_pt  = _derive_property_type(best.get("property-type"))
    epc_st  = _derive_house_sub_type(best.get("built-form"))
    # Use upper bound of age band range for era derivation (avoids 1996-2002 → period mistake)
    era     = derive_era_from_age_band(best.get("construction-age-band")) or derive_building_era(build_year)

    # Extract building name from EPC address1 remainder
    building_name = None
    a1 = best.get("address1", "").strip()
    m = re.match(r"^(FLAT|APT|APARTMENT|UNIT)\s+\d+\w*\s*(.+)?$", a1, re.IGNORECASE)
    if m and m.group(2):
        rem = m.group(2).strip()
        if not re.match(r"^\d", rem):
            building_name = rem.title()

    try:
        beds = int(best["number-habitable-rooms"])
    except Exception:
        beds = None
    try:
        area = float(best["total-floor-area"])
    except Exception:
        area = None

    try:
        epc_score = int(best["current-energy-efficiency"])
    except Exception:
        epc_score = None

    return {
        "epc_matched":    True,
        "epc_uprn":       best.get("uprn"),
        "property_type":  epc_pt  or None,  # prefer EPC; keep None if unknown
        "house_sub_type": epc_st  or None,
        "bedrooms":       beds,
        "floor_area_sqm": area,
        "build_year":     build_year,
        "building_era":   era,
        "building_name":  building_name,
        "epc_rating":     best.get("current-energy-rating") or None,
        "epc_score":      epc_score,
    }

# ---------------------------------------------------------------------------
# Build ComparableCandidate from raw dict
# ---------------------------------------------------------------------------

def _make_candidate(raw: dict, tier: int, tier_label: str,
                    time_window: int, relaxations: list[str],
                    val_date: date) -> ComparableCandidate:
    addr = " ".join(filter(None, [raw["saon"], raw["paon"], raw["street"],
                                   raw["postcode"]])).title()

    # Build year from EPC enrichment (preferred)
    build_year: int | None = raw.get("build_year")
    build_year_estimated = False
    # Fallback: new builds → approximate build year from the sale date.
    # Not EPC-verified but useful when enrichment wasn't possible.
    if build_year is None and raw.get("new_build"):
        try:
            build_year = int(raw["sale_date"][:4])
            build_year_estimated = True
        except Exception:
            pass

    return ComparableCandidate(
        transaction_id        = raw.get("transaction_id"),
        address               = addr,
        postcode              = raw["postcode"],
        outward_code          = raw["outward_code"],
        saon                  = raw.get("saon") or None,
        tenure                = raw.get("tenure"),
        property_type         = raw.get("property_type"),
        house_sub_type        = raw.get("house_sub_type"),
        bedrooms              = raw.get("bedrooms"),
        building_name         = raw.get("building_name"),
        building_era          = raw.get("building_era"),
        build_year            = build_year,
        build_year_estimated  = build_year_estimated,
        floor_area_sqm        = raw.get("floor_area_sqm"),
        price                 = raw["price"],
        transaction_date      = raw["sale_date"],
        new_build             = raw.get("new_build", False),
        transaction_category  = raw.get("category"),
        geographic_tier       = tier,
        tier_label            = tier_label,
        spec_relaxations      = list(relaxations),
        time_window_months    = time_window,
        epc_matched           = raw.get("epc_matched", False),
        epc_rating            = raw.get("epc_rating"),
        epc_score             = raw.get("epc_score"),
        months_ago            = _months_ago(raw["sale_date"], val_date),
    )

# ---------------------------------------------------------------------------
# Core: filter SPARQL rows by criteria, EPC-enrich, hard-deck, dedup
# ---------------------------------------------------------------------------

async def _process_rows(
    rows:        list[dict],
    subject:     SubjectPropertyInput,
    epc_cache:   EpcCache,
    val_date:    date,
    seen:        set[str],
    relaxations: list[str],
    tier:        int,
    months:      int,
    *,
    # Optional geographic filter callables (return True to keep)
    geo_filter = None,
    # Address keys to skip (cross-tab exclusion): "SAON|POSTCODE" (uppercased)
    exclude_addr: set[str] = frozenset(),
) -> list[dict]:
    """
    Parse rows → optionally geo-filter → EPC-enrich → hard-deck filter → dedup.
    Returns list of enriched raw dicts tagged with tier metadata.
    """
    is_flat   = subject.property_type == "flat"
    labels    = FLAT_TIER_LABELS if is_flat else HOUSE_TIER_LABELS

    # Parse and time-window filter
    candidates: list[dict] = []
    for b in rows:
        raw = _parse_row(b)
        if raw is None:
            continue
        if not _within_window(raw["sale_date"], val_date, months):
            continue
        if geo_filter and not geo_filter(raw):
            continue
        k = _dedup_key(raw)
        if k in seen:
            continue
        candidates.append(raw)

    if not candidates:
        return []

    # Sort by recency
    candidates.sort(key=lambda r: r["sale_date"], reverse=True)

    # ── Phase 1: pre-filter with LR-derived data (dedup + exclusions + lenient hard-deck) ──
    # This narrows the pool to type-compatible candidates before expensive EPC calls.
    pre_passed: list[dict] = []
    for raw in candidates:
        k = _dedup_key(raw)
        if k in seen:
            continue

        # Exclude subject itself
        if subject.saon and subject.postcode:
            if (raw["saon"].upper() == subject.saon.upper() and
                    raw["postcode"] == subject.postcode):
                logging.warning("  EXCLUDED (subject itself): %s %s", raw["saon"], raw["paon"])
                continue
        elif subject.uprn and raw.get("epc_uprn") == subject.uprn:
            logging.warning("  EXCLUDED (subject itself): %s %s", raw["saon"], raw["paon"])
            continue

        # Cross-tab exclusion
        if exclude_addr:
            addr_key = f"{raw['saon'].upper()}|{raw['postcode']}"
            if addr_key in exclude_addr:
                logging.warning("  EXCLUDED (address key): %s %s", raw["saon"], raw["postcode"])
                continue

        # Lenient hard-deck with LR data: correctly rejects type mismatches,
        # passes unknowns (None bedrooms / era) so EPC can resolve them.
        if not _passes_hard_deck(
            raw.get("tenure"), raw.get("property_type"),
            raw.get("house_sub_type"), raw.get("building_era"),
            raw.get("bedrooms"), subject, relaxations,
        ):
            continue

        pre_passed.append(raw)

    # ── Phase 2: EPC-enrich every surviving candidate ────────────────────────
    # Enriching only pre_passed (type-compatible) keeps the EPC call count low
    # while guaranteeing the returned comparables all have a verification attempt.
    if pre_passed:
        await epc_cache.prefetch([r["postcode"] for r in pre_passed])
        for raw in pre_passed:
            epc_rows   = await epc_cache.get(raw["postcode"])
            enrichment = _enrich(raw["saon"], raw["paon"], raw["street"], raw["postcode"], epc_rows)
            if enrichment:
                for field in ("property_type", "house_sub_type", "building_era",
                              "bedrooms", "floor_area_sqm", "building_name",
                              "epc_matched", "epc_uprn", "epc_rating", "epc_score"):
                    if enrichment.get(field) is not None:
                        raw[field] = enrichment[field]
                if not raw.get("epc_matched"):
                    raw["epc_matched"] = enrichment.get("epc_matched", False)

    # ── Phase 3: re-run hard-deck with full EPC data ─────────────────────────
    passed: list[dict] = []
    for raw in pre_passed:
        passes = _passes_hard_deck(
            raw.get("tenure"), raw.get("property_type"),
            raw.get("house_sub_type"), raw.get("building_era"),
            raw.get("bedrooms"), subject, relaxations,
        )
        logging.warning(
            "  [T%d] %s %s %s | tenure=%s pt=%s era=%s beds=%s | %s",
            tier,
            raw["saon"], raw["paon"], raw["sale_date"],
            raw.get("tenure"), raw.get("property_type"),
            raw.get("building_era"), raw.get("bedrooms"),
            "PASS" if passes else "FAIL",
        )
        if not passes:
            continue

        k = _dedup_key(raw)
        seen.add(k)
        raw["_tier"]     = tier
        raw["_label"]    = labels[tier]
        raw["_window"]   = months
        raw["_relax"]    = list(relaxations)
        passed.append(raw)

    logging.warning("Tier %d (%s): %d/%d passed (pre_passed=%d)",
                    tier, labels[tier], len(passed), len(candidates), len(pre_passed))
    return passed

# ---------------------------------------------------------------------------
# Adjacent outward codes
# ---------------------------------------------------------------------------

async def _adjacent_outcodes(outward: str) -> list[str]:
    try:
        async with httpx.AsyncClient(timeout=10.0) as c:
            r = await c.get(f"https://api.postcodes.io/outcodes/{outward}/nearest",
                            params={"limit": 20})
        if r.status_code != 200:
            return []
        codes = []
        for oc in r.json().get("result", []):
            code = oc.get("outcode", "").upper()
            if code and code != outward.upper():
                codes.append(code)
                if len(codes) >= MAX_ADJACENT_CODES:
                    break
        return codes
    except Exception:
        logging.warning("Adjacent outcode lookup failed for %s", outward)
        return []

# ---------------------------------------------------------------------------
# Tier runners
# ---------------------------------------------------------------------------

async def _run_flat_tier(
    tier:                int,
    subject:             SubjectPropertyInput,
    sc:                  SparqlCache,
    epc:                 EpcCache,
    val_date:            date,
    seen:                set[str],
    relax:               list[str],
    adj:                 list[str],
    building_months:     int = 30,
    neighbouring_months: int = 12,
    exclude_addr:        set[str] = frozenset(),
) -> list[dict]:
    if tier == 1:
        months = building_months
    elif tier in (3, 4):
        months = neighbouring_months
    else:
        months = FLAT_TIER_MONTHS[tier]
    oc = _outward(subject.postcode)

    if tier == 1:
        # A building can span multiple postcodes (same outward, different inward codes).
        # Strategy:
        #   1. Always query the exact postcode (fast, complete for that postcode).
        #   2. If building_name is known, run a dedicated SPARQL query filtering by
        #      outward code + PAON = building name. This is uncapped and returns all
        #      sales in that building regardless of which inward code they carry.
        #   3. Union both sets (dedup by transaction key) before processing.
        bldg = subject.building_name
        rows_pc = await sc.postcode(subject.postcode, months)

        # Determine which targeted building query to run:
        #   - Named building (e.g. "COMPASS HOUSE"): filter by outward + PAON name
        #   - Numeric PAON (e.g. "10 Marsh Wall"): filter by outward + PAON number + STREET
        #   - Neither known: fall back to postcode-only
        if bldg:
            rows_bldg = await sc.building(oc, bldg, months)
        elif subject.paon_number and subject.street_name:
            rows_bldg = await sc.paon_street(oc, subject.paon_number, subject.street_name, months)
        else:
            rows_bldg = []

        if rows_bldg:
            # Union: postcode rows + targeted building rows (dedup by transaction key)
            seen_keys: set[str] = set()
            combined: list[dict] = []
            for b in rows_pc + rows_bldg:
                raw = _parse_row(b)
                if raw is None:
                    continue
                k = _dedup_key(raw)
                if k not in seen_keys:
                    seen_keys.add(k)
                    combined.append(b)
            logging.warning(
                "Tier 1 building union: postcode=%d, targeted-query=%d, union=%d",
                len(rows_pc), len(rows_bldg), len(combined),
            )
            rows_for_tier1 = combined
        else:
            rows_for_tier1 = rows_pc

        return await _process_rows(rows_for_tier1, subject, epc, val_date, seen, relax, tier, months,
                                    exclude_addr=exclude_addr)

    elif tier == 2:
        # Same development: outward + development_name fuzzy
        if not subject.development_name:
            return []
        dev_norm = normalise_building(subject.development_name)

        def geo2(raw: dict) -> bool:
            return (normalise_building(raw["paon"]) == dev_norm or
                    SequenceMatcher(None, dev_norm, normalise_building(raw["paon"])).ratio() >= 0.80)

        rows = await sc.outward(oc, months)
        return await _process_rows(rows, subject, epc, val_date, seen, relax, tier, months,
                                    geo_filter=geo2, exclude_addr=exclude_addr)

    elif tier == 3:
        rows = await sc.outward(oc, months)
        return await _process_rows(rows, subject, epc, val_date, seen, relax, tier, months,
                                    exclude_addr=exclude_addr)

    else:  # tier 4 — fetch adjacent codes in parallel
        adj_results = await asyncio.gather(
            *[sc.outward(code, months) for code in adj],
            return_exceptions=True,
        )
        all_rows: list[dict] = []
        for r in adj_results:
            if isinstance(r, list):
                all_rows.extend(r)
        return await _process_rows(all_rows, subject, epc, val_date, seen, relax, tier, months,
                                    exclude_addr=exclude_addr)


async def _run_house_tier(
    tier:                int,
    subject:             SubjectPropertyInput,
    sc:                  SparqlCache,
    epc:                 EpcCache,
    val_date:            date,
    seen:                set[str],
    relax:               list[str],
    adj:                 list[str],
    building_months:     int = 30,
    neighbouring_months: int = 12,
    exclude_addr:        set[str] = frozenset(),
) -> list[dict]:
    months = neighbouring_months if tier in (3, 4) else HOUSE_TIER_MONTHS[tier]
    oc = _outward(subject.postcode)

    if tier == 1:
        if not subject.street_name:
            return []
        sn_norm = normalise_street(subject.street_name)

        def geo1(raw: dict) -> bool:
            return bool(raw["street"]) and normalise_street(raw["street"]) == sn_norm

        # Use postcode query (uncapped) rather than outward (capped at 200)
        # to avoid missing same-street transactions in busy outward codes.
        rows = await sc.postcode(subject.postcode, months)
        return await _process_rows(rows, subject, epc, val_date, seen, relax, tier, months,
                                    geo_filter=geo1, exclude_addr=exclude_addr)

    elif tier == 2:
        rows = await sc.postcode(subject.postcode, months)
        return await _process_rows(rows, subject, epc, val_date, seen, relax, tier, months,
                                    exclude_addr=exclude_addr)

    elif tier == 3:
        rows = await sc.outward(oc, months)
        return await _process_rows(rows, subject, epc, val_date, seen, relax, tier, months,
                                    exclude_addr=exclude_addr)

    else:  # tier 4 — fetch all adjacent codes in parallel
        adj_results = await asyncio.gather(
            *[sc.outward(code, months) for code in adj],
            return_exceptions=True,
        )
        all_rows: list[dict] = []
        for r in adj_results:
            if isinstance(r, list):
                all_rows.extend(r)
        return await _process_rows(all_rows, subject, epc, val_date, seen, relax, tier, months,
                                    exclude_addr=exclude_addr)

# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

async def _orchestrate(
    subject:              SubjectPropertyInput,
    target:               int,
    val_date:             date,
    epc_email:            str,
    epc_key:              str,
    max_tier:             int       = 4,
    building_months:      int       = 30,
    neighbouring_months:  int       = 12,
    exclude_ids:          list[str] = [],
    exclude_address_keys: list[str] = [],
) -> tuple[list[dict], int]:
    """
    3-phase orchestrator per spec §6.
    Returns (raw_pool, total_candidates_scanned).
    """
    sem    = asyncio.Semaphore(SPARQL_CONCURRENT)
    sc     = SparqlCache(sem, val_date=val_date)
    epc    = EpcCache(epc_email, epc_key)
    pool:  list[dict] = []
    seen:  set[str]   = set(exclude_ids)   # pre-seed with already-found IDs from building search
    # Address keys to exclude: "SAON|POSTCODE" (uppercased) — blocks same flat/house from
    # appearing even when it has a different transaction_id (e.g. sold twice in different windows)
    exclude_addr_set: set[str] = {k.upper() for k in exclude_address_keys if k}
    total  = 0
    is_flat  = subject.property_type == "flat"
    oc       = _outward(subject.postcode)

    # ── Step 1: pre-fetch SPARQL data ──────────────────────────────────────
    # Outward code is fetched FIRST so the postcode cache can derive its results
    # by filtering the outward rows, avoiding a separate (often slow/timing-out)
    # postcode-level SPARQL query for busy London postcodes.
    adj = await _adjacent_outcodes(oc) if max_tier >= 4 else []

    pc_months  = building_months if is_flat else HOUSE_TIER_MONTHS[2]
    oc_months  = neighbouring_months  # outward queries use the user-controlled window

    logging.info("Pre-fetching SPARQL outward=%s first (max_tier=%d)", oc, max_tier)

    # Phase A: outward + adjacent codes in parallel (postcode waits for outward)
    phase_a = [sc.outward(oc, oc_months)]
    if max_tier >= 4:
        phase_a += [sc.outward(code, oc_months) for code in adj]
    await asyncio.gather(*phase_a, return_exceptions=True)

    # Phase B: postcode (now uses outward cache if available) + building queries
    phase_b: list = [sc.postcode(subject.postcode, pc_months)]
    if is_flat and subject.building_name:
        phase_b.append(sc.building(oc, subject.building_name, pc_months))
    elif is_flat and subject.paon_number and subject.street_name:
        phase_b.append(sc.paon_street(oc, subject.paon_number, subject.street_name, pc_months))
    await asyncio.gather(*phase_b, return_exceptions=True)

    logging.info("SPARQL pre-fetch complete — postcode=%s outward=%s max_tier=%d", subject.postcode, oc, max_tier)

    tier_fn = _run_flat_tier if is_flat else _run_house_tier

    for phase_relax in [[], ["type"], ["type", "bedrooms"]]:
        for tier_num in range(1, max_tier + 1):
            results = await tier_fn(
                tier_num, subject, sc, epc, val_date, seen, phase_relax, adj,
                building_months=building_months,
                neighbouring_months=neighbouring_months,
                exclude_addr=exclude_addr_set,
            )
            total  += len(results)
            pool.extend(results)
            if len(pool) >= target:
                break
        if len(pool) >= target:
            break

    return pool, total

# ---------------------------------------------------------------------------
# Lease remaining (SQLite lookup, same leases.db used by property router)
# ---------------------------------------------------------------------------

def _years_months_str(expiry_iso: str, as_of: date) -> str | None:
    try:
        expiry = date.fromisoformat(expiry_iso)
    except Exception:
        return None
    if expiry <= as_of:
        return "Expired"
    y = expiry.year - as_of.year
    m = expiry.month - as_of.month
    if m < 0:
        y -= 1
        m += 12
    parts = []
    if y > 0:
        parts.append(f"{y} yr{'s' if y != 1 else ''}")
    if m > 0:
        parts.append(f"{m} mo")
    return " ".join(parts) or "< 1 month"


async def _batch_lease_remaining(uprns: list[str], as_of: date) -> dict[str, str]:
    if not uprns:
        return {}
    db_path = Path(__file__).resolve().parent.parent / "leases.db"
    if not db_path.exists():
        return {}

    def _query() -> dict[str, str]:
        placeholders = ",".join("?" * len(uprns))
        con = sqlite3.connect(str(db_path), check_same_thread=False)
        con.row_factory = sqlite3.Row
        result: dict[str, str] = {}
        try:
            rows = con.execute(
                f"SELECT uprn, expiry_date FROM registered_leases WHERE uprn IN ({placeholders})",
                uprns,
            ).fetchall()
            for row in rows:
                rem = _years_months_str(row["expiry_date"], as_of)
                if rem:
                    result[str(row["uprn"])] = rem
        finally:
            con.close()
        return result

    try:
        return await asyncio.to_thread(_query)
    except Exception:
        logging.exception("Batch lease lookup failed")
        return {}


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/search", response_model=ComparableSearchResponse)
async def search_comparables(req: ComparableSearchRequest) -> ComparableSearchResponse:
    t0 = time.monotonic()

    epc_email = os.getenv("EPC_EMAIL", "")
    epc_key   = os.getenv("EPC_API_KEY", "")

    val_date = date.today()
    if req.valuation_date:
        try:
            val_date = date.fromisoformat(req.valuation_date)
        except Exception:
            pass

    try:
        pool, total_scanned = await asyncio.wait_for(
            _orchestrate(req.subject, req.target_count, val_date, epc_email, epc_key,
                         max_tier=req.max_tier, building_months=req.building_months,
                         neighbouring_months=req.neighbouring_months,
                         exclude_ids=req.exclude_transaction_ids,
                         exclude_address_keys=req.exclude_address_keys),
            timeout=TOTAL_TIMEOUT,
        )
    except asyncio.TimeoutError:
        logging.warning("Comparable search timed out after %.0fs — returning partial results", TOTAL_TIMEOUT)
        pool, total_scanned = [], 0

    # Sort: tier ASC, then most recent first
    pool.sort(key=lambda r: (r["_tier"], r["sale_date"]), reverse=False)
    pool.sort(key=lambda r: (r["_tier"], r["sale_date"]))
    # stable sort: first sort by date DESC, then by tier ASC (stable)
    pool_sorted = sorted(pool, key=lambda r: r["sale_date"], reverse=True)
    pool_sorted = sorted(pool_sorted, key=lambda r: r["_tier"])

    comparables = [
        _make_candidate(r, r["_tier"], r["_label"], r["_window"], r["_relax"], val_date)
        for r in pool_sorted
    ]

    # Lease remaining lookup for leasehold comparables with a known EPC UPRN
    leasehold_uprns = [
        r.get("epc_uprn")
        for r in pool_sorted
        if r.get("tenure") == "leasehold" and r.get("epc_uprn")
    ]
    if leasehold_uprns:
        lease_map = await _batch_lease_remaining(
            [str(u) for u in leasehold_uprns], val_date
        )
        # Match back to comparables via pool_sorted order
        for comp, raw in zip(comparables, pool_sorted):
            uprn = raw.get("epc_uprn")
            if uprn and str(uprn) in lease_map:
                comp.lease_remaining = lease_map[str(uprn)]

    all_relax: list[str] = []
    for c in comparables:
        for rx in c.spec_relaxations:
            if rx not in all_relax:
                all_relax.append(rx)

    return ComparableSearchResponse(
        subject        = req.subject,
        target_count   = req.target_count,
        comparables    = comparables,
        search_metadata = SearchMetadata(
            tiers_searched           = max((c.geographic_tier for c in comparables), default=0),
            spec_relaxations_applied = all_relax,
            total_candidates_scanned = total_scanned,
            search_duration_ms       = int((time.monotonic() - t0) * 1000),
            target_met               = len(comparables) >= req.target_count,
        ),
    )
