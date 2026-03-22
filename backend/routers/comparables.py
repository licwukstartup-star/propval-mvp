"""
Comparable Selection Engine — implements the architecture spec:
  comparable-selection-architecture (2026-03-04).md

Architecture:
  - Hard deck filters: tenure (never), property type (±1 house hierarchy),
    building era for flats (never), bedrooms flats only (±1 when relaxed)
  - 4 geographic tiers per property type (flat / house)
  - 3-phase orchestrator: strict → relax type → relax type+beds
  - Cumulative pool with early exit at target_count
  - On-demand PPD cache: downloads HMLR CSV per outward code into Supabase,
    then queries via SQL.

Data strategy:
  On first search for an outward code, download the full PPD CSV from HMLR
  (~1-5K rows for 36 months, ~400KB) and cache in Supabase. Subsequent
  queries are instant SQL lookups. Cache refreshed every 30 days.
  EPC cache:
    Lazy — fetched on demand when a new postcode is first encountered.
"""

import asyncio
import logging
import os
import re
import time
from pathlib import Path
from datetime import date
from dateutil.relativedelta import relativedelta
from rapidfuzz import fuzz

import httpx
from fastapi import APIRouter, Depends

from .auth import get_current_user
from . import ppd_cache
from fastapi import Request
from pydantic import BaseModel, Field, model_validator
from .rate_limit import limiter
from .property import _get_http_client

router = APIRouter(prefix="/api/comparables", tags=["comparables"])

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

EPC_API_BASE         = "https://epc.opendatacommunities.org/api/v1/domestic/search"
EPC_CONCURRENT       = 10     # max parallel EPC calls
EPC_CALL_TIMEOUT     = 4.0    # EPC API is fast; short timeout avoids blocking
TOTAL_TIMEOUT        = 75.0   # total orchestrator timeout (must be < 90s middleware hard cap)
MAX_ADJACENT_CODES   = 2      # keep tier 4 fast

FLAT_TIER_LABELS     = {1: "Same building", 2: "Same development",
                         3: "Same outward code", 4: "Adjacent area"}
HOUSE_TIER_LABELS    = {1: "Same postcode",  2: "Same street",
                         3: "Same outward code", 4: "Adjacent area"}

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class SubjectPropertyInput(BaseModel):
    address:          str = Field(..., max_length=256)
    postcode:         str = Field(..., max_length=10)
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
        # Auto-populate development_name from building_name to enable Tier 2
        # normalise_building strips noise words (HOUSE, TOWER, etc.) so fuzzy
        # matching "COMPASS HOUSE" vs "COMPASS COURT" works naturally.
        if self.development_name is None and self.building_name:
            self.development_name = self.building_name
        return self


class ComparableSearchRequest(BaseModel):
    subject:                  SubjectPropertyInput
    target_count:             int       = 10
    valuation_date:           str | None = None
    max_tier:                 int       = 4    # cap search at this tier (1-4)
    building_months:          int       = 36   # Tier 1 time window (flat: same building, house: same street)
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
    construction_age_band: str | None = None
    construction_age_best: int | None = None   # PropVal harmonised building age
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
    uprn:                str | None = None
    epc_matched:         bool = False
    epc_rating:          str | None = None   # e.g. "C"
    epc_score:           int | None = None   # e.g. 72
    months_ago:          int | None = None
    lease_remaining:     str | None = None
    distance_m:          float | None = None  # haversine distance from subject (metres)
    coord_source:        str | None = None    # 'os_open_uprn' | 'inspire' | 'postcode' | None
    lat:                 float | None = None  # WGS84 latitude (building-level when UPRN resolved)
    lon:                 float | None = None  # WGS84 longitude


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

# PPD single-letter type codes → (property_type, house_sub_type)
_PPD_TYPE_MAP = {
    "D": ("house", "detached"),
    "S": ("house", "semi-detached"),
    "T": ("house", "terraced"),
    "F": ("flat",  None),
    "O": (None,    None),
}


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
    "2003-2006":   2005, "2007-2011": 2009, "2012-2021": 2016,
    "2007 onwards": 2010,
}

# Strings that mean "no data" in EPC records
_NO_DATA = {"no data!", "no data", "n/a", "unknown", "not recorded", "invalid!"}


def _normalise_age_band(raw: str | None) -> str | None:
    """Clean EPC construction-age-band: strip regional prefix, reject junk values."""
    if not raw:
        return None
    b = raw.strip()
    if b.lower() in _NO_DATA:
        return None
    # Strip "England and Wales: " or "Scotland: " prefix
    if ": " in b:
        b = b.split(": ", 1)[1]
    # Bare 4-digit year (e.g. "2018") — not an age band, it's an actual year
    if re.fullmatch(r"\d{4}", b.strip()):
        return None  # handled separately as construction-year
    return b


def _approx_build_year(age_band: str | None) -> int | None:
    b = _normalise_age_band(age_band)
    if not b:
        # Check if the raw value is a bare year (e.g. "2018")
        if age_band and re.fullmatch(r"\d{4}", age_band.strip()):
            return int(age_band.strip())
        return None
    bl = b.lower()
    for key, yr in _AGE_BAND_MAP.items():
        if key in bl or bl in key:
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
    b = _normalise_age_band(age_band)
    if not b:
        # Check for bare year in raw input
        if age_band and re.fullmatch(r"\d{4}", age_band.strip()):
            return "modern" if int(age_band.strip()) >= 2000 else "period"
        return None
    bl = b.lower()
    if "onwards" in bl or "new" in bl:
        return "modern"
    if "before" in bl:
        return "period"
    years = re.findall(r"\d{4}", bl)
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
    s = re.sub(r"\bSAINT\b", "ST", s)   # normalise SAINT → ST
    s = re.sub(r"[^A-Z0-9 ]", "", s)
    return re.sub(r"\s+", " ", s).strip()


def _building_fuzzy(a: str | None, b: str | None, threshold: float = 80) -> bool:
    """Fuzzy-match two building names using rapidfuzz token_sort_ratio.

    token_sort_ratio handles word-order differences:
      "OLD BREWERY APARTMENTS" vs "APARTMENTS OLD BREWERY" → high score
      "ST JAMES COURT" vs "SAINT JAMES CT" → caught after normalise_building
    """
    if not a or not b:
        return False
    na, nb = normalise_building(a), normalise_building(b)
    if not na or not nb:
        return False
    return na == nb or fuzz.token_sort_ratio(na, nb) >= threshold


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

    # Filter 4: Bedrooms — flats only.
    # For houses, EPC "number-habitable-rooms" counts ALL rooms (beds + reception + kitchen),
    # not just bedrooms, making the comparison meaningless (a 3-bed semi = 6 habitable rooms).
    if subject.property_type == "flat":
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
# EPC index — bulk Supabase cache with live API fallback
# ---------------------------------------------------------------------------

# Translate bulk cache snake_case keys → live API hyphenated keys so _enrich()
# works unchanged regardless of data source.
_BULK_TO_API: dict[str, str] = {
    "construction_year":     "construction-year",
    "construction_age_band": "construction-age-band",
    "construction_age":      "construction-age-band",   # legacy epc_cache name
    "property_type":         "property-type",
    "built_form":            "built-form",
    "habitable_rooms":       "number-habitable-rooms",
    "number_rooms":          "number-habitable-rooms",  # legacy epc_cache name
    "floor_area_sqm":        "total-floor-area",
    "floor_area":            "total-floor-area",        # legacy epc_cache name
    "energy_score":          "current-energy-efficiency",
    "energy_rating":         "current-energy-rating",
    "lodgement_date":        "lodgement-date",
}


def _translate_bulk_row(row: dict) -> dict:
    """Return a copy of a bulk-cache row with field names matching the live EPC API."""
    result = dict(row)
    for snake, hyphen in _BULK_TO_API.items():
        if snake in result:
            result[hyphen] = result.pop(snake)
    return result


class EpcIndex:
    """
    Request-scoped EPC data store.

    On preload(): loads entire outward code(s) from Supabase bulk cache in one
    SQL query — no live API calls. Falls back to live EPC API per-postcode when
    the bulk cache is cold (first search for that area).

    Exposes the same .get(postcode) interface as the old EpcCache so _enrich()
    and all callers are unchanged.
    """

    def __init__(self, email: str, key: str):
        self._email = email
        self._key   = key
        self._sem   = asyncio.Semaphore(EPC_CONCURRENT)
        # Postcodes with bulk-cache data loaded this request
        self._bulk_loaded: set[str] = set()   # outward codes
        # postcode → [epc_rows translated to live-API field names]
        self._by_pc: dict[str, list[dict]] = {}
        # Live API fallback: postcode → [epc_rows] (raw live format)
        self._live: dict[str, list[dict]] = {}

    async def preload(self, outward_codes: list[str]) -> None:
        """Load bulk EPC cache for all outward codes. One SQL round trip."""
        to_load = [oc for oc in outward_codes if oc not in self._bulk_loaded]
        if not to_load:
            return
        rows = await ppd_cache.query_epc_outward_multi(to_load)
        for row in rows:
            pc = (row.get("postcode") or "").strip().upper()
            if pc:
                self._by_pc.setdefault(pc, []).append(_translate_bulk_row(row))
        for oc in to_load:
            self._bulk_loaded.add(oc)
        logging.warning(
            "⏱ EpcIndex: loaded %d rows for outward=%s",
            len(rows), to_load,
        )

    async def get(self, postcode: str) -> list[dict]:
        """Return EPC rows for a postcode. Bulk cache if warm, else live API."""
        pc = postcode.strip().upper()
        oc = _outward(pc)
        if oc in self._bulk_loaded:
            return self._by_pc.get(pc, [])
        # Bulk cache cold — fall back to live API
        if pc not in self._live:
            self._live[pc] = await self._fetch_live(pc)
        return self._live[pc]

    async def prefetch(self, postcodes: list[str]) -> None:
        """Prefetch live API for postcodes not covered by bulk cache.
        No-op for postcodes whose outward code is already bulk-loaded."""
        missing = [
            pc for pc in dict.fromkeys(p.strip().upper() for p in postcodes)
            if _outward(pc) not in self._bulk_loaded and pc not in self._live
        ]
        if not missing:
            return
        results = await asyncio.gather(
            *[self._fetch_live(pc) for pc in missing],
            return_exceptions=True,
        )
        for pc, r in zip(missing, results):
            self._live[pc] = r if isinstance(r, list) else []

    async def _fetch_live(self, postcode: str) -> list[dict]:
        async with self._sem:
            try:
                c = _get_http_client()
                r = await c.get(EPC_API_BASE,
                                params={"postcode": postcode, "size": 5000},
                                auth=(self._email, self._key),
                                headers={"Accept": "application/json"})
                return r.json().get("rows", []) if r.status_code == 200 else []
            except Exception:
                return []

# ---------------------------------------------------------------------------
# PPD cache (on-demand download from HMLR → Supabase SQL queries)
# ---------------------------------------------------------------------------

class PpdCache:
    """On-demand PPD cache. Downloads HMLR CSVs into Supabase on first query,
    then returns flat DB rows for subsequent lookups within the same request."""
    def __init__(self, val_date: date | None = None):
        self._val = val_date
        # In-memory cache for the current request to avoid repeated DB calls
        self._pc:   dict[str, list[dict]] = {}
        self._oc:   dict[str, list[dict]] = {}
        self._bldg: dict[str, list[dict]] = {}

    async def postcode(self, pc: str, months: int) -> list[dict]:
        if pc not in self._pc:
            self._pc[pc] = await ppd_cache.query_postcode(pc, months, val_date=self._val)
        return self._pc[pc]

    async def outward(self, oc: str, months: int) -> list[dict]:
        if oc not in self._oc:
            self._oc[oc] = await ppd_cache.query_outward(oc, months, val_date=self._val)
        return self._oc[oc]

    async def building(self, outward: str, building_name: str, months: int) -> list[dict]:
        key = f"{outward}|{building_name.upper()}|{months}"
        if key not in self._bldg:
            self._bldg[key] = await ppd_cache.query_building(outward, building_name, months, val_date=self._val)
        return self._bldg[key]

    async def building_fuzzy(self, outward: str, building_name: str, months: int) -> list[dict]:
        key = f"fuzzy|{outward}|{building_name.upper()}|{months}"
        if key not in self._bldg:
            self._bldg[key] = await ppd_cache.query_building_fuzzy(outward, building_name, months, val_date=self._val)
        return self._bldg[key]

    async def paon_street(self, outward: str, paon: str, street: str, months: int) -> list[dict]:
        key = f"{outward}|{paon.upper()}|{street.upper()}|{months}"
        if key not in self._bldg:
            self._bldg[key] = await ppd_cache.query_paon_street(outward, paon, street, months, val_date=self._val)
        return self._bldg[key]

    async def street(self, outward: str, street: str, months: int) -> list[dict]:
        key = f"street|{outward}|{street.upper()}|{months}"
        if key not in self._bldg:
            self._bldg[key] = await ppd_cache.query_street(outward, street, months, val_date=self._val)
        return self._bldg[key]

    async def street_multi(self, outward_codes: list[str], street: str, months: int) -> list[dict]:
        key = f"street_multi|{'|'.join(sorted(oc.upper() for oc in outward_codes))}|{street.upper()}|{months}"
        if key not in self._bldg:
            self._bldg[key] = await ppd_cache.query_street_multi(outward_codes, street, months, val_date=self._val)
        return self._bldg[key]

# ---------------------------------------------------------------------------
# PPD row parsing — flat dict in, flat dict out
# ---------------------------------------------------------------------------

def _parse_ppd_row(row: dict) -> dict | None:
    """Parse a flat PPD cache DB row into the internal format used by the search engine."""
    deed = (row.get("deed_date") or "")[:10]
    try:
        date.fromisoformat(deed)
    except Exception:
        return None
    price = row.get("price_paid") or 0
    try:
        price = int(price)
    except (ValueError, TypeError):
        return None
    if price <= 0:
        return None
    pc_raw = (row.get("postcode") or "").strip()
    if not pc_raw or len(pc_raw) < 5:
        return None
    postcode = _normalise_pc(pc_raw)
    pt_code = (row.get("property_type") or "").strip().upper()
    prop_type, sub_type = _PPD_TYPE_MAP.get(pt_code, (None, None))
    et = (row.get("estate_type") or "").strip().upper()
    tenure = "freehold" if et == "F" else "leasehold" if et == "L" else None
    nb = (row.get("new_build") or "").strip().upper()
    cat = (row.get("transaction_category") or "").strip().upper()[:1] or None
    parsed = {
        "transaction_id": row.get("transaction_id") or None,
        "sale_date":      deed,
        "price":          price,
        "postcode":       postcode,
        "outward_code":   _outward(postcode),
        "tenure":         tenure,
        "property_type":  prop_type,
        "house_sub_type": sub_type,
        "new_build":      nb == "Y",
        "category":       cat,
        "saon":           (row.get("saon") or "").strip().upper(),
        "paon":           (row.get("paon") or "").strip().upper(),
        "street":         (row.get("street") or "").strip().upper(),
    }

    # Carry forward pre-enriched EPC fields from spine data (if present)
    epc_type = row.get("epc_property_type")
    if epc_type:
        derived_type = _derive_property_type(epc_type)
        if derived_type:
            parsed["property_type"] = derived_type
        derived_sub = _derive_house_sub_type(row.get("epc_built_form"))
        if derived_sub:
            parsed["house_sub_type"] = derived_sub
        parsed["epc_matched"] = True
        parsed["epc_uprn"] = row.get("uprn")
        parsed["epc_rating"] = row.get("energy_rating")
        parsed["epc_score"] = row.get("energy_score")
        fa = row.get("floor_area_sqm")
        if fa:
            try:
                parsed["floor_area_sqm"] = float(fa)
            except (ValueError, TypeError):
                pass
        rooms = row.get("habitable_rooms")
        if rooms is None:
            rooms = row.get("number_rooms")
        if rooms:
            try:
                parsed["bedrooms"] = int(rooms)
            except (ValueError, TypeError):
                pass
        age_band = row.get("construction_age_band")
        if age_band:
            parsed["construction_age_band"] = _normalise_age_band(age_band)
            parsed["build_year"] = row.get("age_best") or _approx_build_year(age_band)
            parsed["building_era"] = derive_building_era(parsed.get("build_year"))

    return parsed


def _dedup_key(r: dict) -> str:
    if r.get("transaction_id"):
        return r["transaction_id"]
    return f"{r['saon']}|{r['paon']}|{r['street']}|{r['postcode']}|{r['sale_date']}"


def _addr_dedup_key(r: dict) -> str:
    """Address-level dedup: catches same sale with different transaction_ids (Cat A/B)."""
    return (f"{r.get('saon', '')}|{r.get('paon', '')}|{r.get('street', '')}"
            f"|{r.get('postcode', '')}|{r.get('sale_date', '')}|{r.get('price', '')}")

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

    # Stage 1: If we have a house number (PAON), prefer EPC records with exact number match
    # in address1. This prevents "47", "69", "77" on the same street all matching the same
    # EPC record due to fuzzy ratio being nearly identical for whole-address comparisons.
    # CRITICAL: If PAON is numeric and no exact EPC match exists, return empty rather than
    # fuzzy-matching to a different house number (the phantom EPC bug).
    candidates = epc_rows
    paon_num_m = re.match(r"^(\d+)", (paon or "").strip())
    if paon_num_m:
        paon_num = paon_num_m.group(1)
        exact = [r for r in epc_rows
                 if re.match(rf"^{paon_num}\b", (r.get("address1", "") or "").strip())]
        if exact:
            candidates = exact
        else:
            # No EPC with this house number — do NOT fall back to fuzzy matching
            # across all records (would match e.g. 47 to 69 on same street).
            return {}

    # Stage 2: Also try SAON (flat number) pre-filtering for flats
    if saon:
        saon_num_m = re.match(r"^(?:FLAT|APT|APARTMENT|UNIT)?\s*(\d+)", saon.strip(), re.IGNORECASE)
        if saon_num_m:
            saon_num = saon_num_m.group(1)
            saon_exact = [r for r in candidates
                          if re.search(rf"\b(?:FLAT|APT|APARTMENT|UNIT)\s*{saon_num}\b",
                                       (r.get("address1", "") or ""), re.IGNORECASE)]
            if saon_exact:
                candidates = saon_exact

    # Stage 3: Fuzzy match within the (possibly filtered) pool.
    # Break ties by preferring the most recent EPC certificate (lodgement-date desc)
    # to avoid matching old/phantom certificates with stale UPRNs.
    addr = " ".join(filter(None, [saon, paon, street, postcode])).lower()
    best = max(candidates, key=lambda r: (
        fuzz.ratio(addr, _epc_addr(r).lower()),
        r.get("lodgement-date") or r.get("lodgement_date") or "",
    ))
    if fuzz.ratio(addr, _epc_addr(best).lower()) < 25:
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

    age_band_raw = _normalise_age_band(best.get("construction-age-band"))
    return {
        "epc_matched":    True,
        "epc_uprn":       best.get("uprn"),
        "property_type":  epc_pt  or None,  # prefer EPC; keep None if unknown
        "house_sub_type": epc_st  or None,
        "bedrooms":       beds,
        "floor_area_sqm": area,
        "build_year":     build_year,
        "building_era":   era,
        "construction_age_band": age_band_raw,
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
        uprn                  = raw.get("epc_uprn"),
        tenure                = raw.get("tenure"),
        property_type         = raw.get("property_type"),
        house_sub_type        = raw.get("house_sub_type"),
        bedrooms              = raw.get("bedrooms"),
        building_name         = raw.get("building_name"),
        building_era          = raw.get("building_era"),
        construction_age_band = raw.get("construction_age_band"),
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
        distance_m            = raw.get("_dist_m"),
        coord_source          = raw.get("_coord_source"),
        lat                   = raw.get("_lat"),
        lon                   = raw.get("_lon"),
    )

# ---------------------------------------------------------------------------
# Core: filter PPD rows by criteria, EPC-enrich, hard-deck, dedup
# ---------------------------------------------------------------------------

async def _process_rows(
    rows:        list[dict],
    subject:     SubjectPropertyInput,
    epc_cache:   EpcIndex,
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
        raw = _parse_ppd_row(b)
        if raw is None:
            continue
        if not _within_window(raw["sale_date"], val_date, months):
            continue
        if geo_filter and not geo_filter(raw):
            continue
        k = _dedup_key(raw)
        if k in seen:
            continue
        ak = _addr_dedup_key(raw)
        if ak in seen:
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
        ak = _addr_dedup_key(raw)
        if ak in seen:
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
                              "construction_age_band", "build_year",
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
        seen.add(_addr_dedup_key(raw))
        raw["_tier"]     = tier
        raw["_label"]    = labels[tier]
        raw["_window"]   = months
        raw["_relax"]    = list(relaxations)
        passed.append(raw)

    logging.warning("Tier %d (%s): %d/%d passed (pre_passed=%d)",
                    tier, labels[tier], len(passed), len(candidates), len(pre_passed))
    return passed


    # _process_local_rows removed — spine data processed via _process_rows


# ---------------------------------------------------------------------------
# Adjacent outward codes
# ---------------------------------------------------------------------------

async def _adjacent_outcodes(outward: str) -> list[str]:
    try:
        c = _get_http_client()
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
    sc:                  PpdCache,
    epc:                 EpcIndex,
    val_date:            date,
    seen:                set[str],
    relax:               list[str],
    adj:                 list[str],
    building_months:     int = 30,
    neighbouring_months: int = 12,
    exclude_addr:        set[str] = frozenset(),
) -> list[dict]:
    months = building_months if tier in (1, 2) else neighbouring_months
    oc = _outward(subject.postcode)

    if tier == 1:
        # A building can span multiple postcodes (same outward, different inward codes).
        # Strategy:
        #   1. Always query the exact postcode (fast, complete for that postcode).
        #   2. If building_name is known, run a dedicated query filtering by
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
            # Exact prefix/contains match + rapidfuzz fuzzy match (parallel)
            rows_exact, rows_fuzzy = await asyncio.gather(
                sc.building(oc, bldg, months),
                sc.building_fuzzy(oc, bldg, months),
            )
            # Union exact + fuzzy results (dedup by transaction_id)
            bldg_seen: set[str] = set()
            rows_bldg: list[dict] = []
            for b in rows_exact + rows_fuzzy:
                tid = b.get("transaction_id", "")
                if tid and tid not in bldg_seen:
                    bldg_seen.add(tid)
                    rows_bldg.append(b)
                elif not tid:
                    rows_bldg.append(b)
            logging.warning(
                "Tier 1 building queries: exact=%d, fuzzy=%d, union=%d",
                len(rows_exact), len(rows_fuzzy), len(rows_bldg),
            )
            # Street validation: filter out false positives from similarly-named
            # buildings on different streets
            if rows_bldg and subject.street_name:
                sn_norm = normalise_street(subject.street_name)
                rows_bldg = [b for b in rows_bldg
                             if not (b.get("street") or "").strip()
                             or normalise_street(b["street"]) == sn_norm]
        elif subject.paon_number and subject.street_name:
            rows_bldg = await sc.paon_street(oc, subject.paon_number, subject.street_name, months)
        else:
            rows_bldg = []

        if rows_bldg:
            # Union: postcode rows + targeted building rows (dedup by transaction key)
            seen_keys: set[str] = set()
            combined: list[dict] = []
            for b in rows_pc + rows_bldg:
                raw = _parse_ppd_row(b)
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
        # Same development (named block) OR same street (numbered building)
        if subject.development_name:
            dev_norm = normalise_building(subject.development_name)

            def geo2(raw: dict) -> bool:
                paon_norm = normalise_building(raw["paon"])
                return (paon_norm == dev_norm or
                        fuzz.token_sort_ratio(dev_norm, paon_norm) >= 80)

            rows = await sc.outward(oc, months)
            return await _process_rows(rows, subject, epc, val_date, seen, relax, tier, months,
                                        geo_filter=geo2, exclude_addr=exclude_addr)
        elif subject.street_name:
            # Flat in numbered building (e.g. "27 Albert Embankment") — street walk
            sn_norm = normalise_street(subject.street_name)

            def geo_street(raw: dict) -> bool:
                return bool(raw.get("street")) and normalise_street(raw["street"]) == sn_norm

            search_codes = [oc] + adj
            rows = await sc.street_multi(search_codes, subject.street_name, months)
            logging.warning(
                "Flat Tier 2 street fallback: %s across %d codes → %d rows",
                subject.street_name, len(search_codes), len(rows),
            )
            return await _process_rows(rows, subject, epc, val_date, seen, relax, tier, months,
                                        geo_filter=geo_street, exclude_addr=exclude_addr)
        else:
            return []

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
    sc:                  PpdCache,
    epc:                 EpcIndex,
    val_date:            date,
    seen:                set[str],
    relax:               list[str],
    adj:                 list[str],
    building_months:     int = 30,
    neighbouring_months: int = 12,
    exclude_addr:        set[str] = frozenset(),
) -> list[dict]:
    months = building_months if tier in (1, 2) else neighbouring_months
    oc = _outward(subject.postcode)

    if tier == 1:
        # Tier 1: Same postcode — all house sales in the exact postcode
        rows = await sc.postcode(subject.postcode, months)
        return await _process_rows(rows, subject, epc, val_date, seen, relax, tier, months,
                                    exclude_addr=exclude_addr)

    elif tier == 2:
        # Tier 2: Same street — across subject's outward code + adjacent codes
        # Excludes Tier 1 results (already in `seen` set from the orchestrator)
        if not subject.street_name:
            return []
        sn_norm = normalise_street(subject.street_name)

        def geo_street(raw: dict) -> bool:
            return bool(raw["street"]) and normalise_street(raw["street"]) == sn_norm

        search_codes = [oc] + adj
        rows_street = await sc.street_multi(search_codes, subject.street_name, months)
        logging.warning(
            "House Tier 2 street search: %s across %d codes → %d rows",
            subject.street_name, len(search_codes), len(rows_street),
        )
        return await _process_rows(rows_street, subject, epc, val_date, seen, relax, tier, months,
                                    geo_filter=geo_street, exclude_addr=exclude_addr)

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

def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine distance in metres between two WGS84 points."""
    from math import atan2, cos, radians, sin, sqrt
    R = 6_371_000
    p1, p2 = radians(lat1), radians(lat2)
    dp = radians(lat2 - lat1)
    dl = radians(lon2 - lon1)
    a = sin(dp / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))


async def _bulk_geocode_postcodes(postcodes: list[str]) -> dict[str, tuple[float, float]]:
    """
    Bulk geocode up to 100 postcodes in one postcodes.io POST request.
    Returns {postcode: (lat, lng)} for successful lookups only.
    """
    if not postcodes:
        return {}
    results: dict[str, tuple[float, float]] = {}
    try:
        c = _get_http_client()
        r = await c.post(
            "https://api.postcodes.io/postcodes",
            json={"postcodes": postcodes[:100]},
            timeout=5.0,
        )
        if r.status_code != 200:
            return results
        for item in r.json().get("result", []):
            if item and item.get("result"):
                pc  = item["query"]
                lat = item["result"].get("latitude")
                lng = item["result"].get("longitude")
                if lat and lng:
                    results[pc] = (float(lat), float(lng))
    except Exception:
        logging.warning("Bulk postcode geocode failed")
    return results


async def _annotate_pool_with_distances(
    pool: list[dict],
    subj_lat: float,
    subj_lng: float,
    inspire,   # InspireService | None
    uprn_coords=None,  # UPRNCoordService | None
) -> list[dict]:
    """
    For each comparable in pool, resolve coordinates and compute distance.

    Coordinate resolution priority:
      1. OS Open UPRN (building-level, ~1-5m) — via epc_uprn
      2. INSPIRE centroid (polygon-level, ~10-50m) — London only
      3. Postcode centroid (~100m) — last resort

    Stores _dist_m, _coord_source, _lat, _lon on the raw dict.
    """
    # 1. Batch UPRN lookup — building-level coords for every comp with epc_uprn
    uprn_map: dict[str, tuple[float, float]] = {}
    if uprn_coords and uprn_coords.loaded:
        uprns = [str(r["epc_uprn"]) for r in pool if r.get("epc_uprn")]
        if uprns:
            uprn_map = uprn_coords.lookup_batch(uprns)

    # Apply UPRN coords (overrides any pre-resolved postcode-level coords)
    needs_postcode_pcs: list[str] = []
    for r in pool:
        epc_uprn = str(r.get("epc_uprn", "")) if r.get("epc_uprn") else ""
        if epc_uprn and epc_uprn in uprn_map:
            r["_lat"], r["_lon"] = uprn_map[epc_uprn]
            r["_coord_source"] = "os_open_uprn"
        elif r.get("_lat") is None or r.get("_lon") is None:
            needs_postcode_pcs.append(r["postcode"])

    # 2. Fallback: bulk postcode geocode for comps without any coords
    pc_coords: dict[str, tuple[float, float]] = {}
    if needs_postcode_pcs:
        pc_coords = await _bulk_geocode_postcodes(list(set(needs_postcode_pcs)))

    for r in pool:
        if r.get("_lat") is None or r.get("_lon") is None:
            pc_latlon = pc_coords.get(r["postcode"])
            if not pc_latlon:
                continue
            r["_lat"], r["_lon"] = pc_latlon
            r["_coord_source"] = "postcode"

        if r.get("_lat") is not None and r.get("_lon") is not None:
            r["_dist_m"] = _haversine_m(subj_lat, subj_lng, r["_lat"], r["_lon"])

    return pool


# _orchestrate_local removed — all comparable queries go through Supabase spine via _orchestrate


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
    3-phase orchestrator per spec §6. Falls back to Supabase pipeline.
    Returns (raw_pool, total_candidates_scanned).
    """
    sc     = PpdCache(val_date=val_date)
    epc    = EpcIndex(epc_email, epc_key)
    pool:  list[dict] = []
    seen:  set[str]   = set(exclude_ids)   # pre-seed with already-found IDs from building search
    # Address keys to exclude: "SAON|POSTCODE" (uppercased) — blocks same flat/house from
    # appearing even when it has a different transaction_id (e.g. sold twice in different windows)
    exclude_addr_set: set[str] = {k.upper() for k in exclude_address_keys if k}
    total  = 0
    is_flat  = subject.property_type == "flat"
    oc       = _outward(subject.postcode)

    # ── Step 1: warm PPD cache + preload EPC index — all parallel ─────────
    _t0 = time.monotonic()
    adj = await _adjacent_outcodes(oc) if max_tier >= 4 else []
    codes_to_cache = [oc] + adj

    # Warm PPD + EPC bulk caches in parallel, then load EPC index.
    # Both must complete before epc.preload() queries Supabase.
    await asyncio.gather(
        *[ppd_cache.ensure_cache(code) for code in codes_to_cache],
        *[ppd_cache._ensure_epc_background(code) for code in codes_to_cache],
        return_exceptions=True,
    )
    await epc.preload(codes_to_cache)

    logging.warning("⏱ Comp: PPD+EPC warm in %.0fms — outward=%s adjacents=%s",
                    (time.monotonic() - _t0) * 1000, oc, adj)

    tier_fn = _run_flat_tier if is_flat else _run_house_tier

    for phase_relax in [[], ["type"], ["type", "bedrooms"]]:
        for tier_num in range(1, max_tier + 1):
            _tt = time.monotonic()
            results = await tier_fn(
                tier_num, subject, sc, epc, val_date, seen, phase_relax, adj,
                building_months=building_months,
                neighbouring_months=neighbouring_months,
                exclude_addr=exclude_addr_set,
            )
            logging.warning("⏱ Comp: Tier %d relax=%s → %d results in %.0fms",
                            tier_num, phase_relax, len(results), (time.monotonic() - _tt) * 1000)
            total  += len(results)
            pool.extend(results)
            if len(pool) >= target:
                break
        if len(pool) >= target:
            break

    logging.warning("⏱ Comp: TOTAL orchestrator %.0fms, pool=%d", (time.monotonic() - _t0) * 1000, len(pool))
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
    """Batch lease remaining lookup from Supabase registered_leases."""
    if not uprns:
        return {}

    def _query() -> dict[str, str]:
        sb = ppd_cache._get_sb()
        if sb is None:
            return {}
        result: dict[str, str] = {}
        # Query in batches of 100 to avoid URL length limits
        for i in range(0, len(uprns), 100):
            batch = uprns[i:i + 100]
            resp = sb.table("registered_leases") \
                .select("uprn, expiry_date") \
                .in_("uprn", batch) \
                .execute()
            for row in (resp.data or []):
                expiry = row.get("expiry_date")
                if expiry:
                    rem = _years_months_str(str(expiry), as_of)
                    if rem:
                        result[str(row["uprn"])] = rem
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
@limiter.limit("10/minute")
async def search_comparables(request: Request, req: ComparableSearchRequest, _user: dict = Depends(get_current_user)) -> ComparableSearchResponse:
    t0 = time.monotonic()

    epc_email = os.getenv("EPC_EMAIL", "")
    epc_key   = os.getenv("EPC_API_KEY", "")

    val_date = date.today()
    if req.valuation_date:
        try:
            val_date = date.fromisoformat(req.valuation_date)
        except Exception:
            pass

    # Query Supabase spine tables (transactions) for comparables
    pool, total_scanned = [], 0

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
    except Exception:
        logging.exception("Comparable search failed")

    # Annotate pool with distances if subject coordinates are available
    subj_lat = req.subject.lat
    subj_lng = req.subject.lon
    inspire      = getattr(request.app.state, "inspire", None)
    uprn_coords  = getattr(request.app.state, "uprn_coords", None)

    if subj_lat is not None and subj_lng is not None and pool:
        try:
            pool = await asyncio.wait_for(
                _annotate_pool_with_distances(pool, subj_lat, subj_lng, inspire, uprn_coords),
                timeout=5.0,
            )
        except asyncio.TimeoutError:
            logging.warning("Distance annotation timed out — falling back to date sort")

    # Sort: tier ASC, then distance ASC (if available), then most recent first
    has_distances = any(r.get("_dist_m") is not None for r in pool)
    if has_distances:
        pool_sorted = sorted(
            pool,
            key=lambda r: (r["_tier"], r.get("_dist_m") or 999_999, r["sale_date"]),
        )
    else:
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

    # ── Construction age from spine data (pre-enriched in transactions table) ──
    for comp, raw in zip(comparables, pool_sorted):
        age_best = raw.get("age_best")
        if age_best and comp.construction_age_best is None:
            try:
                comp.construction_age_best = int(age_best)
            except (ValueError, TypeError):
                pass

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


# ---------------------------------------------------------------------------
# Browse Sales — raw PPD data with server-side filters, no hard deck
# ---------------------------------------------------------------------------

_PROP_TYPE_LABELS = {"D": "Detached", "S": "Semi-detached", "T": "Terraced",
                     "F": "Flat", "O": "Other"}
_TENURE_LABELS    = {"F": "Freehold", "L": "Leasehold"}


class BrowseRequest(BaseModel):
    outward_code:   str = Field(..., max_length=5)
    property_type:  str | None = None   # D/S/T/F/O
    estate_type:    str | None = None   # F/L
    min_date:       str | None = None   # ISO date
    max_date:       str | None = None
    min_price:      int | None = None
    max_price:      int | None = None
    new_build:      str | None = None   # Y/N
    exclude_postcode: str | None = None  # exclude subject's own postcode
    force_refresh:  bool = False         # force re-download from HMLR


def _epc_to_enrichment(epc: dict) -> dict:
    """Extract enrichment fields from an EPC record."""
    build_year = None
    try:
        cy = epc.get("construction_year", "")
        if cy:
            build_year = int(cy)
    except (ValueError, TypeError):
        pass
    if build_year is None:
        build_year = _approx_build_year(epc.get("construction-age-band"))

    age_band = _normalise_age_band(epc.get("construction-age-band"))
    era = derive_era_from_age_band(epc.get("construction-age-band")) or derive_building_era(build_year)

    return {
        "bedrooms":               epc.get("number_rooms"),
        "floor_area_sqm":         epc.get("floor_area"),
        "epc_rating":             epc.get("energy_rating") or None,
        "epc_score":              epc.get("energy_score"),
        "build_year":             build_year,
        "building_era":           era,
        "construction_age_band":  age_band,
        "epc_matched":            True,
    }


def _normalise_addr(s: str) -> str:
    """Collapse address to uppercase alphanumeric tokens for fast comparison."""
    import re
    return re.sub(r"[^A-Z0-9 ]", "", s.upper()).strip()


def _match_ppd_to_epc(ppd_rows: list[dict], epc_rows: list[dict]) -> dict[str, dict]:
    """Pre-match PPD transactions to EPC records.

    Uses a two-pass strategy: (1) exact normalised address lookup (O(1) per row),
    then (2) fuzzy matching only for unmatched rows. This is 10-50x faster than
    brute-force fuzzy matching every row.

    Returns: {transaction_id → {bedrooms, floor_area_sqm, epc_rating, epc_score,
              build_year, epc_matched}}
    """
    if not epc_rows:
        return {}

    # Build EPC index: (postcode, normalised_address) → EPC record
    epc_by_pc: dict[str, list[dict]] = {}
    epc_exact: dict[tuple[str, str], dict] = {}
    for e in epc_rows:
        pc = e.get("postcode", "")
        epc_addr = _normalise_addr(" ".join(filter(None, [
            e.get("address1", ""), e.get("address2", ""), e.get("address3", ""),
        ])))
        if pc and epc_addr:
            epc_exact[(pc, epc_addr)] = e
        if pc not in epc_by_pc:
            epc_by_pc[pc] = []
        epc_by_pc[pc].append((epc_addr, e))

    enriched: dict[str, dict] = {}
    fuzzy_queue: list[tuple[str, str, str, list]] = []  # (tid, ppd_addr, pc, candidates)

    # Pass 1: exact match (instant)
    for r in ppd_rows:
        tid = r.get("transaction_id", "")
        pc = r.get("postcode", "")
        ppd_addr = _normalise_addr(" ".join(filter(None, [
            r.get("saon", ""), r.get("paon", ""), r.get("street", ""),
        ])))
        if not ppd_addr or not pc:
            continue

        exact = epc_exact.get((pc, ppd_addr))
        if exact:
            enriched[tid] = _epc_to_enrichment(exact)
        else:
            candidates = epc_by_pc.get(pc, [])
            if candidates:
                fuzzy_queue.append((tid, ppd_addr, pc, candidates))

    # Pass 2: fuzzy match only for unmatched rows
    for tid, ppd_addr, pc, candidates in fuzzy_queue:
        best_score = 0
        best_epc = None
        for epc_addr, e in candidates:
            score = fuzz.token_sort_ratio(ppd_addr, epc_addr)
            if score > best_score:
                best_score = score
                best_epc = e
        if best_score >= 60 and best_epc:
            enriched[tid] = _epc_to_enrichment(best_epc)

    return enriched


@router.post("/browse")
async def browse_sales(request: Request, req: BrowseRequest, _user: dict = Depends(get_current_user)):
    """Return all PPD transactions for an outward code, with optional filters.
    Tries local DuckDB first (pre-enriched with EPC + coordinates), falls back to Supabase.
    """
    t0 = time.monotonic()
    outward = req.outward_code.strip().upper()

    # --- Query Supabase spine (transactions table) ---
    def _query() -> list[dict]:
        sb = ppd_cache._get_sb()
        q = sb.table("transactions").select(ppd_cache._SPINE_SELECT).eq("outward_code", outward)
        if req.property_type:
            q = q.eq("ppd_type", req.property_type.upper())
        if req.estate_type:
            q = q.eq("duration", req.estate_type.upper())
        if req.min_date:
            q = q.gte("date_of_transfer", req.min_date)
        if req.max_date:
            q = q.lte("date_of_transfer", req.max_date)
        if req.min_price:
            q = q.gte("price", req.min_price)
        if req.max_price:
            q = q.lte("price", req.max_price)
        if req.new_build:
            q = q.eq("old_new", req.new_build.upper())
        q = q.order("date_of_transfer", desc=True)

        resp = q.limit(10000).execute()
        return ppd_cache._spine_rows(resp.data or [])

    rows = await asyncio.to_thread(_query)

    if req.exclude_postcode:
        pc = req.exclude_postcode.strip().upper()
        rows = [r for r in rows if r.get("postcode") != pc]

    epc_match: dict[str, dict] = {}
    try:
        epc_rows = await ppd_cache.query_epc_outward(outward)
        if epc_rows:
            epc_match = await asyncio.to_thread(_match_ppd_to_epc, rows, epc_rows)
            logging.warning("Browse EPC pre-match: %d/%d matched", len(epc_match), len(rows))
    except Exception:
        logging.exception("EPC pre-match failed for %s (non-fatal)", outward)

    results = []
    for r in rows:
        saon = r.get("saon", "")
        paon = r.get("paon", "")
        street = r.get("street", "")
        address = " ".join(filter(None, [saon, paon, street])).title()
        tid = r.get("transaction_id", "")

        row_data = {
            "transaction_id":  tid,
            "address":         address,
            "postcode":        r.get("postcode", ""),
            "price":           r.get("price_paid", 0),
            "date":            r.get("deed_date", ""),
            "property_type":   _PROP_TYPE_LABELS.get(r.get("property_type", ""), r.get("property_type", "")),
            "tenure":          _TENURE_LABELS.get(r.get("estate_type", ""), r.get("estate_type", "")),
            "new_build":       r.get("new_build", "") == "Y",
            "category":        r.get("transaction_category", ""),
            "_type_code":      r.get("property_type", ""),
            "_tenure_code":    r.get("estate_type", ""),
            "raw_saon":        saon,
            "_paon":           paon,
            "_street":         street,
            "_locality":       r.get("locality", ""),
            "_town":           r.get("town", ""),
            "_district":       r.get("district", ""),
            "_county":         r.get("county", ""),
        }

        epc = epc_match.get(tid)
        if epc:
            row_data.update(epc)

        results.append(row_data)

    duration = int((time.monotonic() - t0) * 1000)
    epc_count = sum(1 for r in results if r.get("epc_matched"))
    logging.warning("Browse %s: %d results (%d EPC-enriched) in %dms",
                    outward, len(results), epc_count, duration)

    return {
        "outward_code": outward,
        "total":        len(results),
        "epc_matched":  epc_count,
        "duration_ms":  duration,
        "results":      results,
    }


# ---------------------------------------------------------------------------
# Enrich — EPC-enrich a batch of transactions
# ---------------------------------------------------------------------------

class EnrichRequest(BaseModel):
    transactions: list[dict]   # [{transaction_id, raw_saon, _paon, _street, postcode}, ...]


@router.post("/enrich")
async def enrich_transactions(req: EnrichRequest, _user: dict = Depends(get_current_user)):
    """EPC-enrich a batch of transactions.

    First tries the local EPC cache (bulk-downloaded alongside PPD).
    Falls back to live EPC API for any postcodes not in cache.
    """
    t0 = time.monotonic()

    # Collect unique postcodes
    postcodes = list({t.get("postcode", "") for t in req.transactions if t.get("postcode")})

    # Try EPC cache first
    cached_epc: dict[str, list[dict]] = {}
    uncached_pcs: list[str] = []
    for pc in postcodes:
        try:
            rows = await ppd_cache.query_epc_cached(pc)
            if rows:
                cached_epc[pc] = rows
            else:
                uncached_pcs.append(pc)
        except Exception:
            uncached_pcs.append(pc)

    # Fall back to live API for uncached postcodes
    if uncached_pcs:
        epc_email = os.getenv("EPC_EMAIL", "")
        epc_key   = os.getenv("EPC_API_KEY", "")
        epc = EpcCache(epc_email, epc_key)
        await epc.prefetch(uncached_pcs)
    else:
        epc = None

    enriched = {}
    for t in req.transactions:
        tid = t.get("transaction_id", "")
        saon = t.get("raw_saon", "") or t.get("_saon", "")
        paon = t.get("_paon", "")
        street = t.get("_street", "")
        pc = t.get("postcode", "")

        if pc in cached_epc:
            # Use cached EPC — convert to the format _enrich expects
            epc_rows = _epc_cache_to_api_format(cached_epc[pc])
        elif epc and pc:
            epc_rows = await epc.get(pc)
        else:
            epc_rows = []

        data = _enrich(saon, paon, street, pc, epc_rows)

        enriched[tid] = {
            "bedrooms":       data.get("bedrooms"),
            "floor_area_sqm": data.get("floor_area_sqm"),
            "epc_rating":     data.get("epc_rating"),
            "epc_score":      data.get("epc_score"),
            "build_year":     data.get("build_year"),
            "building_era":   data.get("building_era"),
            "tenure":         data.get("tenure"),
            "epc_matched":    data.get("epc_matched", False),
        }

    duration = int((time.monotonic() - t0) * 1000)
    logging.warning("Enrich: %d transactions, %d cached/%d live postcodes in %dms",
                    len(req.transactions), len(cached_epc), len(uncached_pcs), duration)

    return {
        "enriched":    enriched,
        "duration_ms": duration,
    }


@router.get("/cache-status")
async def cache_status(_user: dict = Depends(get_current_user)):
    """Return spine data status."""
    def _status() -> dict:
        sb = ppd_cache._get_sb()
        ppd_status = []
        epc_status = []

        ppd_rows = 0
        epc_rows = sum(r.get("row_count", 0) for r in epc_status)
        # Rough size estimate: ~200 bytes per PPD row, ~250 bytes per EPC row
        est_mb = (ppd_rows * 200 + epc_rows * 250) / (1024 * 1024)

        return {
            "ppd_outward_codes": len(ppd_status),
            "ppd_total_rows":   ppd_rows,
            "epc_outward_codes": len(epc_status),
            "epc_total_rows":   epc_rows,
            "estimated_mb":     round(est_mb, 1),
            "warning":          "Approaching Supabase free tier limit (500MB)" if est_mb > 400 else None,
            "details":          {
                "ppd": ppd_status,
                "epc": epc_status,
            },
        }

    return await asyncio.to_thread(_status)


# ---------------------------------------------------------------------------
# Address Lookup — find PPD transactions for a specific address (Additional Comparable tab)
# ---------------------------------------------------------------------------

class AddressLookupRequest(BaseModel):
    postcode: str = Field(..., max_length=10)
    address:  str = Field(..., max_length=256)
    uprn:     str | None = None


@router.post("/address-lookup")
@limiter.limit("20/minute")
async def address_lookup(request: Request, req: AddressLookupRequest, _user: dict = Depends(get_current_user)):
    """Find all PPD transactions for a specific address and enrich with EPC data.

    Used by the 'Additional Comparable' tab to let valuers search for any
    property by postcode, then adopt its transactions as comparables.
    """
    t0 = time.monotonic()
    pc = req.postcode.strip().upper()
    outward = pc.split()[0] if " " in pc else pc[:-3].strip()
    if not outward:
        return {"transactions": [], "duration_ms": 0}

    # Warm PPD + EPC caches in parallel
    await asyncio.gather(
        ppd_cache.ensure_cache(outward),
        ppd_cache._ensure_epc_background(outward),
        return_exceptions=True,
    )

    # Query PPD for this postcode
    def _query() -> list[dict]:
        sb = ppd_cache._get_sb()
        q = (sb.table("price_paid_cache")
             .select("*")
             .eq("outward_code", outward)
             .eq("postcode", pc)
             .order("deed_date", desc=True))
        resp = q.limit(2000).execute()
        return resp.data or []

    ppd_rows = await asyncio.to_thread(_query)

    # Fuzzy-match to the selected address to find the specific property
    target_addr = _normalise_addr(req.address)

    # Extract the flat/apartment identifier (SAON) from the target address
    # so we can enforce it matches for multi-unit buildings
    import re as _re
    _saon_pat = _re.compile(
        r"(?:FLAT|APARTMENT|APT|UNIT|ROOM|STUDIO)\s+[A-Z0-9][\w\-]*",
        _re.IGNORECASE,
    )
    target_saon_m = _saon_pat.search(req.address)
    target_saon = _normalise_addr(target_saon_m.group()) if target_saon_m else None

    matched_rows = []
    for r in ppd_rows:
        ppd_saon_raw = r.get("saon", "") or ""
        ppd_paon = r.get("paon", "") or ""
        ppd_street = r.get("street", "") or ""
        ppd_addr = _normalise_addr(" ".join(filter(None, [ppd_saon_raw, ppd_paon, ppd_street])))

        # Exact normalised match — always accept
        if ppd_addr == target_addr:
            matched_rows.append(r)
            continue

        # For flat/apartment addresses, the SAON must match to avoid
        # pulling in every unit in the same building (e.g. 64 flats in Luma House)
        if target_saon:
            row_saon_m = _saon_pat.search(ppd_saon_raw)
            row_saon = _normalise_addr(row_saon_m.group()) if row_saon_m else _normalise_addr(ppd_saon_raw)
            if row_saon != target_saon:
                continue  # different flat — skip regardless of overall fuzzy score

        # Fuzzy fallback for non-flat addresses or same-SAON rows
        if fuzz.token_sort_ratio(ppd_addr, target_addr) >= 75:
            matched_rows.append(r)

    # EPC enrichment
    epc_match: dict[str, dict] = {}
    try:
        epc_rows = await ppd_cache.query_epc_outward(outward)
        if epc_rows:
            epc_match = await asyncio.to_thread(_match_ppd_to_epc, matched_rows, epc_rows)
    except Exception:
        logging.exception("Address lookup EPC enrichment failed (non-fatal)")

    # Also try to get EPC data directly for the address (for properties with no PPD)
    epc_direct: dict | None = None
    try:
        epc_rows_all = await ppd_cache.query_epc_outward(outward)
        if epc_rows_all:
            for e in epc_rows_all:
                epc_addr = _normalise_addr(" ".join(filter(None, [
                    e.get("address1", ""), e.get("address2", ""), e.get("address3", ""),
                ])))
                if epc_addr == target_addr or fuzz.token_sort_ratio(epc_addr, target_addr) >= 75:
                    epc_direct = e
                    break
    except Exception:
        pass

    # Format as ComparableCandidate-shaped dicts
    transactions = []
    now = date.today()
    for r in matched_rows:
        saon = r.get("saon", "")
        paon = r.get("paon", "")
        street = r.get("street", "")
        address = " ".join(filter(None, [saon, paon, street])).title()
        tid = r.get("transaction_id", "")
        deed_date = r.get("deed_date", "")
        price = r.get("price_paid", 0)

        # Property type mapping
        pt_code = r.get("property_type", "")
        prop_type = "flat" if pt_code == "F" else "house" if pt_code in ("D", "S", "T") else None
        sub_type = {"D": "detached", "S": "semi-detached", "T": "terraced"}.get(pt_code)
        tenure = "freehold" if r.get("estate_type") == "F" else "leasehold" if r.get("estate_type") == "L" else None

        # Calculate months ago
        months_ago = None
        if deed_date:
            try:
                tx = date.fromisoformat(deed_date)
                months_ago = (now.year - tx.year) * 12 + (now.month - tx.month)
            except ValueError:
                pass

        comp: dict = {
            "transaction_id":       tid or None,
            "address":              address,
            "postcode":             r.get("postcode", pc),
            "outward_code":         outward,
            "saon":                 saon or None,
            "tenure":               tenure,
            "property_type":        prop_type,
            "house_sub_type":       sub_type,
            "bedrooms":             None,
            "building_name":        None,
            "building_era":         None,
            "build_year":           None,
            "build_year_estimated": False,
            "floor_area_sqm":       None,
            "price":                price,
            "transaction_date":     deed_date,
            "new_build":            r.get("new_build", "") == "Y",
            "transaction_category": r.get("transaction_category"),
            "geographic_tier":      0,
            "tier_label":           "Additional",
            "spec_relaxations":     [],
            "time_window_months":   0,
            "epc_matched":          False,
            "epc_rating":           None,
            "epc_score":            None,
            "months_ago":           months_ago,
            "lease_remaining":      None,
        }

        # Merge EPC enrichment if available
        epc = epc_match.get(tid)
        if epc:
            comp["bedrooms"]      = epc.get("bedrooms")
            comp["floor_area_sqm"] = epc.get("floor_area_sqm")
            comp["epc_rating"]    = epc.get("epc_rating")
            comp["epc_score"]     = epc.get("epc_score")
            comp["build_year"]    = epc.get("build_year")
            comp["epc_matched"]   = True

        transactions.append(comp)

    # Build EPC summary for the address (even if no PPD transactions)
    epc_summary = None
    if epc_direct:
        epc_summary = {
            "floor_area_sqm":  epc_direct.get("floor_area"),
            "bedrooms":        epc_direct.get("number_rooms"),
            "epc_rating":      epc_direct.get("energy_rating"),
            "epc_score":       epc_direct.get("energy_score"),
            "build_year":      epc_direct.get("construction_year"),
            "property_type":   epc_direct.get("property_type"),
            "built_form":      epc_direct.get("built_form"),
            "tenure":          epc_direct.get("tenure"),
        }

    duration = int((time.monotonic() - t0) * 1000)
    logging.warning("Address lookup %s '%s': %d transactions (%d EPC-enriched) in %dms",
                    pc, req.address[:40], len(transactions),
                    sum(1 for t in transactions if t.get("epc_matched")), duration)

    return {
        "postcode":      pc,
        "address":       req.address,
        "transactions":  transactions,
        "epc_summary":   epc_summary,
        "duration_ms":   duration,
    }


def _epc_cache_to_api_format(cache_rows: list[dict]) -> list[dict]:
    """Convert epc_cache DB rows to the same dict format as the live EPC API returns,
    so _enrich() works unchanged."""
    result = []
    for r in cache_rows:
        result.append({
            "address1":                  r.get("address1", ""),
            "address2":                  r.get("address2", ""),
            "address3":                  r.get("address3", ""),
            "address":                   r.get("address", ""),
            "postcode":                  r.get("postcode", ""),
            "property-type":             r.get("property_type", ""),
            "built-form":                r.get("built_form", ""),
            "total-floor-area":          str(r["floor_area"]) if r.get("floor_area") else "",
            "number-habitable-rooms":    str(r["number_rooms"]) if r.get("number_rooms") else "",
            "current-energy-rating":     r.get("energy_rating", ""),
            "current-energy-efficiency": str(r["energy_score"]) if r.get("energy_score") else "",
            "construction-year":         r.get("construction_year", ""),
            "construction-age-band":     r.get("construction_age", ""),
            "tenure":                    r.get("tenure", ""),
            "lodgement-date":            r.get("lodgement_date", ""),
        })
    return result
