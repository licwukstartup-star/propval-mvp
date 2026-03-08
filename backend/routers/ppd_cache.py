"""
Price Paid Data — on-demand cache backed by Supabase.

Flow:
  1. Caller asks for transactions in an outward code (e.g. "W2").
  2. We check `ppd_cache_status` in Supabase — is the data fresh (< 30 days)?
  3. If missing/stale → download CSV from HMLR, upsert into `price_paid_cache`.
  4. Query `price_paid_cache` with SQL filters and return rows in the same
     dict format that `_parse_row` in comparables.py expects (SPARQL-binding shape).

Tables required in Supabase (run once via SQL editor):
  See `ensure_tables()` or the SQL at the bottom of this file.
"""

import asyncio
import csv
import io
import logging
import os
from datetime import date, datetime, timedelta

import httpx
from rapidfuzz import fuzz, process
from supabase import create_client

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

HMLR_CSV_URL = "https://landregistry.data.gov.uk/app/ppd/ppd_data.csv"
CACHE_MAX_AGE_DAYS = 30          # re-download after this many days
DOWNLOAD_TIMEOUT   = 60.0        # seconds for HMLR CSV download
BATCH_SIZE         = 500         # rows per Supabase upsert call

# CSV columns (with header=true)
CSV_COLS = [
    "unique_id", "price_paid", "deed_date", "postcode", "property_type",
    "new_build", "estate_type", "saon", "paon", "street", "locality",
    "town", "district", "county", "transaction_category", "linked_data_uri",
]


# ---------------------------------------------------------------------------
# Supabase client (singleton)
# ---------------------------------------------------------------------------

_sb = None
_epc_download_lock = asyncio.Lock()       # only one EPC download at a time
_epc_downloading: set[str] = set()        # outward codes currently downloading

def _get_sb():
    global _sb
    if _sb is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set")
        _sb = create_client(url, key)
    return _sb


def _outward(postcode: str) -> str:
    """Extract outward code from a full postcode, e.g. 'W2 2LU' → 'W2'."""
    parts = postcode.strip().upper().split()
    return parts[0] if parts else postcode.strip().upper()


# ---------------------------------------------------------------------------
# Cache freshness check
# ---------------------------------------------------------------------------

def _is_cache_fresh_sync(outward: str) -> bool:
    """Check ppd_cache_status to see if outward code was fetched recently."""
    sb = _get_sb()
    try:
        resp = sb.table("ppd_cache_status") \
            .select("last_fetched") \
            .eq("outward_code", outward) \
            .execute()
        if resp.data and len(resp.data) > 0:
            last = resp.data[0]["last_fetched"]
            if last:
                fetched = datetime.fromisoformat(last.replace("Z", "+00:00"))
                age = datetime.now(fetched.tzinfo) - fetched
                return age < timedelta(days=CACHE_MAX_AGE_DAYS)
    except Exception:
        logging.exception("ppd_cache_status check failed for %s", outward)
    return False


# ---------------------------------------------------------------------------
# Download & ingest
# ---------------------------------------------------------------------------

async def _download_csv(outward: str) -> list[dict]:
    """Download PPD CSV from HMLR for an outward code. Returns parsed rows."""
    url = HMLR_CSV_URL
    params = {
        "limit": "all",
        "postcode": outward,
        "header": "true",
    }
    logging.warning("PPD cache: downloading %s from HMLR …", outward)
    async with httpx.AsyncClient(timeout=httpx.Timeout(
        connect=10.0, read=DOWNLOAD_TIMEOUT, write=5.0, pool=5.0
    )) as client:
        resp = await client.get(url, params=params)
    if resp.status_code != 200:
        logging.error("HMLR CSV download failed: HTTP %d for %s", resp.status_code, outward)
        return []

    reader = csv.DictReader(io.StringIO(resp.text), fieldnames=CSV_COLS)
    # Skip header row (first row matches fieldnames)
    rows = []
    for i, row in enumerate(reader):
        if i == 0 and row.get("unique_id") == "unique_id":
            continue  # skip header
        # Clean quotes from values
        cleaned = {k: (v.strip('" ') if v else "") for k, v in row.items()}
        rows.append(cleaned)
    logging.warning("PPD cache: downloaded %d rows for %s", len(rows), outward)
    return rows


def _ingest(outward: str, rows: list[dict]) -> None:
    """Upsert rows into price_paid_cache and update ppd_cache_status.
    Synchronous — Supabase Python client is sync. Run via asyncio.to_thread.
    """
    sb = _get_sb()

    # Prepare rows for Supabase
    db_rows = []
    for r in rows:
        uid = r.get("unique_id", "").strip()
        if not uid:
            continue
        try:
            price = int(r.get("price_paid", "0"))
        except (ValueError, TypeError):
            continue
        if price <= 0:
            continue

        db_rows.append({
            "transaction_id": uid,
            "outward_code": outward.upper(),
            "postcode": r.get("postcode", "").strip().upper(),
            "deed_date": r.get("deed_date", ""),
            "price_paid": price,
            "property_type": r.get("property_type", "").strip().upper(),
            "new_build": r.get("new_build", "").strip().upper(),
            "estate_type": r.get("estate_type", "").strip().upper(),
            "saon": r.get("saon", "").strip().upper(),
            "paon": r.get("paon", "").strip().upper(),
            "street": r.get("street", "").strip().upper(),
            "locality": r.get("locality", "").strip().upper(),
            "town": r.get("town", "").strip().upper(),
            "district": r.get("district", "").strip().upper(),
            "county": r.get("county", "").strip().upper(),
            "transaction_category": r.get("transaction_category", "").strip().upper(),
        })

    if not db_rows:
        return

    # Batch upsert
    for i in range(0, len(db_rows), BATCH_SIZE):
        batch = db_rows[i:i + BATCH_SIZE]
        try:
            sb.table("price_paid_cache") \
                .upsert(batch, on_conflict="transaction_id") \
                .execute()
        except Exception:
            logging.exception("PPD upsert batch %d failed for %s", i // BATCH_SIZE, outward)

    # Update cache status
    try:
        sb.table("ppd_cache_status").upsert({
            "outward_code": outward.upper(),
            "last_fetched": datetime.utcnow().isoformat(),
            "row_count": len(db_rows),
        }, on_conflict="outward_code").execute()
    except Exception:
        logging.exception("ppd_cache_status upsert failed for %s", outward)

    logging.warning("PPD cache: ingested %d rows for %s", len(db_rows), outward)


async def ensure_cache(outward: str) -> None:
    """Ensure PPD cache is populated and fresh. PPD only — fast.
    Used by comparable search (which has its own EPC enrichment)."""
    outward = outward.strip().upper()
    fresh = await asyncio.to_thread(_is_cache_fresh_sync, outward)
    if not fresh:
        rows = await _download_csv(outward)
        if rows:
            await asyncio.to_thread(_ingest, outward, rows)
    else:
        logging.warning("PPD cache: %s is fresh, skipping download", outward)


async def ensure_cache_with_epc(outward: str) -> None:
    """Ensure PPD cache is ready. EPC bulk download is DISABLED —
    EPC enrichment now happens on-demand per postcode via the enrich endpoint."""
    await ensure_cache(outward)


async def _ensure_epc_background(outward: str) -> None:
    """Background task to ensure EPC cache is populated. Errors are logged, not raised."""
    try:
        await ensure_epc_cache(outward)
    except Exception:
        logging.exception("Background EPC cache failed for %s", outward)


async def force_refresh(outward: str) -> None:
    """Force re-download from HMLR, ignoring cache freshness."""
    outward = outward.strip().upper()
    logging.warning("PPD cache: force refresh for %s", outward)
    rows = await _download_csv(outward)
    if rows:
        await asyncio.to_thread(_ingest, outward, rows)


# ---------------------------------------------------------------------------
# Query helpers — return flat dicts matching DB schema
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Sync query helpers (run via asyncio.to_thread)
# ---------------------------------------------------------------------------

def _query_postcode_sync(pc: str, date_from: str) -> list[dict]:
    sb = _get_sb()
    resp = sb.table("price_paid_cache") \
        .select("*") \
        .eq("postcode", pc) \
        .gte("deed_date", date_from) \
        .execute()
    return resp.data or []


def _query_building_sync(outward: str, bldg: str, date_from: str) -> list[dict]:
    sb = _get_sb()
    # Query 1: PAON starts with building name (e.g. "QUEENS WHARF" or "QUEENS WHARF, 2")
    resp1 = sb.table("price_paid_cache") \
        .select("*") \
        .eq("outward_code", outward) \
        .ilike("paon", f"{bldg}%") \
        .gte("deed_date", date_from) \
        .execute()
    # Query 2: PAON contains building name after a number prefix (e.g. "2 QUEENS WHARF")
    resp2 = sb.table("price_paid_cache") \
        .select("*") \
        .eq("outward_code", outward) \
        .ilike("paon", f"% {bldg}%") \
        .gte("deed_date", date_from) \
        .execute()
    # Dedup by transaction_id
    seen: set[str] = set()
    rows: list[dict] = []
    for r in (resp1.data or []) + (resp2.data or []):
        tid = r.get("transaction_id", "")
        if tid and tid not in seen:
            seen.add(tid)
            rows.append(r)
    return rows


def _query_building_fuzzy_sync(outward: str, bldg: str, date_from: str,
                                threshold: float = 75) -> list[dict]:
    """Fuzzy building name discovery using rapidfuzz.

    Pulls all unique PAONs for the outward code, scores them against
    the target building name using token_sort_ratio, then fetches
    transactions for any PAON scoring above `threshold`.

    This catches cases like:
      "OLD BREWERY" vs "OLD BREWERY APARTMENTS"
      "ST JAMES COURT" vs "SAINT JAMES COURT"
      "QUEENS WHARF" vs "QUEEN'S WHARF"
    """
    sb = _get_sb()
    # Get distinct PAONs for this outward code (lightweight query)
    resp = sb.table("price_paid_cache") \
        .select("paon") \
        .eq("outward_code", outward) \
        .gte("deed_date", date_from) \
        .execute()
    if not resp.data:
        return []

    # Deduplicate PAONs
    all_paons = list({r["paon"] for r in resp.data if r.get("paon")})
    if not all_paons:
        return []

    # Strip noise words for comparison (HOUSE, TOWER, COURT, etc.)
    import re
    _NOISE = re.compile(
        r"\b(HOUSE|TOWER|COURT|LODGE|HALL|MANSIONS?|APARTMENTS?|BUILDING|"
        r"BLOCK|PLACE|RESIDENCE|CHAMBERS?|POINT)\b", re.I
    )
    def _norm(s: str) -> str:
        s = _NOISE.sub("", s.upper())
        s = re.sub(r"\bSAINT\b", "ST", s)   # normalise SAINT → ST
        s = re.sub(r"[^A-Z0-9 ]", "", s)
        return re.sub(r"\s+", " ", s).strip()

    bldg_norm = _norm(bldg)
    if not bldg_norm:
        return []

    # Score all PAONs against the building name
    paon_norms = {p: _norm(p) for p in all_paons}
    matching_paons: list[str] = []
    for paon, pn in paon_norms.items():
        if not pn:
            continue
        score = fuzz.token_sort_ratio(bldg_norm, pn)
        if score >= threshold:
            matching_paons.append(paon)
            logging.info("Fuzzy building match: %r → %r (score=%.0f)", bldg, paon, score)

    if not matching_paons:
        return []

    # Fetch transactions for all matching PAONs
    rows: list[dict] = []
    seen: set[str] = set()
    for paon in matching_paons:
        resp2 = sb.table("price_paid_cache") \
            .select("*") \
            .eq("outward_code", outward) \
            .eq("paon", paon) \
            .gte("deed_date", date_from) \
            .execute()
        for r in (resp2.data or []):
            tid = r.get("transaction_id", "")
            if tid and tid not in seen:
                seen.add(tid)
                rows.append(r)
    return rows


def _query_paon_street_sync(outward: str, paon: str, street: str, date_from: str) -> list[dict]:
    sb = _get_sb()
    resp = sb.table("price_paid_cache") \
        .select("*") \
        .eq("outward_code", outward) \
        .eq("paon", paon) \
        .eq("street", street) \
        .gte("deed_date", date_from) \
        .execute()
    return resp.data or []


def _query_street_sync(outward: str, street: str, date_from: str) -> list[dict]:
    """All transactions on a specific street within an outward code."""
    sb = _get_sb()
    all_rows: list[dict] = []
    offset = 0
    while True:
        resp = sb.table("price_paid_cache") \
            .select("*") \
            .eq("outward_code", outward) \
            .eq("street", street) \
            .gte("deed_date", date_from) \
            .range(offset, offset + 999) \
            .execute()
        rows = resp.data or []
        all_rows.extend(rows)
        if len(rows) < 1000:
            break
        offset += 1000
    return all_rows


def _query_outward_sync(outward: str, date_from: str) -> list[dict]:
    sb = _get_sb()
    resp = sb.table("price_paid_cache") \
        .select("*") \
        .eq("outward_code", outward) \
        .gte("deed_date", date_from) \
        .execute()
    return resp.data or []


def _query_postcode_all_sync(pc: str) -> list[dict]:
    sb = _get_sb()
    resp = sb.table("price_paid_cache") \
        .select("*") \
        .eq("postcode", pc) \
        .order("deed_date", desc=True) \
        .execute()
    return resp.data or []


# ---------------------------------------------------------------------------
# Public async query API — mirrors SparqlCache interface
# ---------------------------------------------------------------------------

async def query_postcode(postcode: str, months: int,
                         val_date: date | None = None) -> list[dict]:
    """All transactions for an exact postcode within last N months."""
    pc = postcode.strip().upper()
    outward = _outward(pc)
    await ensure_cache(outward)

    anchor = val_date or date.today()
    date_from = (anchor - timedelta(days=months * 30)).isoformat()

    rows = await asyncio.to_thread(_query_postcode_sync, pc, date_from)
    logging.warning("PPD query postcode %s → %d rows", pc, len(rows))
    return rows


async def query_building(outward: str, building_name: str, months: int,
                         val_date: date | None = None) -> list[dict]:
    """All transactions where PAON starts with building_name in outward code."""
    outward = outward.strip().upper()
    await ensure_cache(outward)

    anchor = val_date or date.today()
    date_from = (anchor - timedelta(days=months * 30)).isoformat()
    bldg = building_name.strip().upper()

    rows = await asyncio.to_thread(_query_building_sync, outward, bldg, date_from)
    logging.warning("PPD query building %s/%s → %d rows", outward, bldg, len(rows))
    return rows


async def query_building_fuzzy(outward: str, building_name: str, months: int,
                               val_date: date | None = None,
                               threshold: float = 75) -> list[dict]:
    """Fuzzy building name discovery — finds similar building names in PPD cache."""
    outward = outward.strip().upper()
    await ensure_cache(outward)

    anchor = val_date or date.today()
    date_from = (anchor - timedelta(days=months * 30)).isoformat()
    bldg = building_name.strip().upper()

    rows = await asyncio.to_thread(_query_building_fuzzy_sync, outward, bldg, date_from, threshold)
    logging.warning("PPD fuzzy building %s/%s → %d rows (threshold=%.0f)", outward, bldg, len(rows), threshold)
    return rows


async def query_street(outward: str, street: str, months: int,
                       val_date: date | None = None) -> list[dict]:
    """All transactions on a specific street within an outward code."""
    outward = outward.strip().upper()
    await ensure_cache(outward)

    anchor = val_date or date.today()
    date_from = (anchor - timedelta(days=months * 30)).isoformat()
    street_upper = street.strip().upper()

    rows = await asyncio.to_thread(_query_street_sync, outward, street_upper, date_from)
    logging.warning("PPD query street %s/%s → %d rows", outward, street_upper, len(rows))
    return rows


async def query_street_multi(outward_codes: list[str], street: str, months: int,
                              val_date: date | None = None) -> list[dict]:
    """Search a street across multiple outward codes (for streets spanning boundaries)."""
    # Ensure all caches are warm
    await asyncio.gather(
        *[ensure_cache(oc.strip().upper()) for oc in outward_codes],
        return_exceptions=True,
    )

    anchor = val_date or date.today()
    date_from = (anchor - timedelta(days=months * 30)).isoformat()
    street_upper = street.strip().upper()

    # Query all outward codes in parallel
    results = await asyncio.gather(
        *[asyncio.to_thread(_query_street_sync, oc.strip().upper(), street_upper, date_from)
          for oc in outward_codes],
        return_exceptions=True,
    )

    all_rows: list[dict] = []
    seen: set[str] = set()
    for r in results:
        if isinstance(r, list):
            for row in r:
                tid = row.get("transaction_id", "")
                if tid and tid not in seen:
                    seen.add(tid)
                    all_rows.append(row)

    logging.warning("PPD query street multi %s/%s → %d rows across %d codes",
                    street_upper, outward_codes, len(all_rows), len(outward_codes))
    return all_rows


async def query_paon_street(outward: str, paon: str, street: str, months: int,
                            val_date: date | None = None) -> list[dict]:
    """All transactions with exact PAON + STREET in outward code."""
    outward = outward.strip().upper()
    await ensure_cache(outward)

    anchor = val_date or date.today()
    date_from = (anchor - timedelta(days=months * 30)).isoformat()

    rows = await asyncio.to_thread(
        _query_paon_street_sync, outward, paon.strip().upper(), street.strip().upper(), date_from
    )
    logging.warning("PPD query paon+street %s/%s/%s → %d rows", outward, paon, street, len(rows))
    return rows


async def query_outward(outward: str, months: int,
                        val_date: date | None = None) -> list[dict]:
    """All transactions in an outward code within last N months."""
    outward = outward.strip().upper()
    await ensure_cache(outward)

    anchor = val_date or date.today()
    date_from = (anchor - timedelta(days=months * 30)).isoformat()

    rows = await asyncio.to_thread(_query_outward_sync, outward, date_from)
    logging.warning("PPD query outward %s → %d rows", outward, len(rows))
    return rows


async def query_by_postcode_all_time(postcode: str) -> list[dict]:
    """All transactions for an exact postcode — no date filter.
    Used for subject property's own sales history."""
    pc = postcode.strip().upper()
    outward = _outward(pc)
    await ensure_cache(outward)

    rows = await asyncio.to_thread(_query_postcode_all_sync, pc)
    logging.warning("PPD query all-time postcode %s → %d rows", pc, len(rows))
    return rows


# ---------------------------------------------------------------------------
# SQL to create tables (run in Supabase SQL editor)
# ---------------------------------------------------------------------------

TABLE_SQL = """
-- Price Paid Data cache
CREATE TABLE IF NOT EXISTS price_paid_cache (
    transaction_id   TEXT PRIMARY KEY,
    outward_code     TEXT NOT NULL,
    postcode         TEXT NOT NULL,
    deed_date        DATE NOT NULL,
    price_paid       INTEGER NOT NULL,
    property_type    TEXT,      -- D/S/T/F/O
    new_build        TEXT,      -- Y/N
    estate_type      TEXT,      -- F/L
    saon             TEXT,      -- flat/unit
    paon             TEXT,      -- building number/name
    street           TEXT,
    locality         TEXT,
    town             TEXT,
    district         TEXT,
    county           TEXT,
    transaction_category TEXT   -- A/B
);

CREATE INDEX IF NOT EXISTS idx_ppc_outward   ON price_paid_cache (outward_code);
CREATE INDEX IF NOT EXISTS idx_ppc_postcode  ON price_paid_cache (postcode);
CREATE INDEX IF NOT EXISTS idx_ppc_date      ON price_paid_cache (deed_date);
CREATE INDEX IF NOT EXISTS idx_ppc_paon_str  ON price_paid_cache (outward_code, paon, street);

-- Cache freshness tracker
CREATE TABLE IF NOT EXISTS ppd_cache_status (
    outward_code  TEXT PRIMARY KEY,
    last_fetched  TIMESTAMPTZ NOT NULL,
    row_count     INTEGER DEFAULT 0
);
"""


# ===========================================================================
# EPC BULK CACHE — download entire outward code's EPC records
# ===========================================================================

EPC_API_BASE       = "https://epc.opendatacommunities.org/api/v1/domestic/search"
EPC_CONCURRENT     = 10       # max parallel EPC API calls
EPC_CALL_TIMEOUT   = 10.0     # per-postcode timeout
EPC_BATCH_SIZE     = 500      # rows per Supabase upsert

# Fields we extract from each EPC record (keep storage lean)
_EPC_FIELDS = [
    "lmk-key", "address1", "address2", "address3", "address",
    "postcode", "property-type", "built-form", "total-floor-area",
    "number-habitable-rooms", "current-energy-rating", "current-energy-efficiency",
    "construction-year", "construction-age-band", "tenure",
    "lodgement-date",
]


def _is_epc_cache_fresh_sync(outward: str) -> bool:
    """Check epc_cache_status to see if outward code was fetched recently."""
    sb = _get_sb()
    try:
        resp = sb.table("epc_cache_status") \
            .select("last_fetched") \
            .eq("outward_code", outward) \
            .execute()
        if resp.data and len(resp.data) > 0:
            last = resp.data[0]["last_fetched"]
            if last:
                fetched = datetime.fromisoformat(last.replace("Z", "+00:00"))
                age = datetime.now(fetched.tzinfo) - fetched
                return age < timedelta(days=CACHE_MAX_AGE_DAYS)
    except Exception:
        logging.exception("epc_cache_status check failed for %s", outward)
    return False


async def _fetch_epc_postcode(postcode: str, sem: asyncio.Semaphore,
                               email: str, api_key: str) -> list[dict]:
    """Fetch all EPC records for a single postcode."""
    async with sem:
        try:
            async with httpx.AsyncClient(timeout=EPC_CALL_TIMEOUT) as c:
                r = await c.get(EPC_API_BASE,
                                params={"postcode": postcode, "size": 5000},
                                auth=(email, api_key),
                                headers={"Accept": "application/json"})
            if r.status_code != 200:
                return []
            # EPC API returns empty body for postcodes with no certificates
            body = r.text.strip()
            if not body:
                return []
            try:
                return r.json().get("rows", [])
            except Exception:
                return []
        except httpx.TimeoutException:
            logging.warning("EPC fetch timeout for %s", postcode)
            return []
        except Exception:
            logging.exception("EPC fetch failed for %s", postcode)
            return []


def _epc_row_to_db(row: dict, outward: str) -> dict | None:
    """Convert an EPC API row to a db-ready dict. Only keep latest cert per lmk-key."""
    lmk = row.get("lmk-key", "").strip()
    if not lmk:
        return None
    pc = row.get("postcode", "").strip().upper()

    floor_area = None
    try:
        fa = row.get("total-floor-area", "")
        if fa:
            floor_area = float(fa)
    except (ValueError, TypeError):
        pass

    num_rooms = None
    try:
        nr = row.get("number-habitable-rooms", "")
        if nr:
            num_rooms = int(nr)
    except (ValueError, TypeError):
        pass

    score = None
    try:
        sc = row.get("current-energy-efficiency", "")
        if sc:
            score = int(sc)
    except (ValueError, TypeError):
        pass

    return {
        "lmk_key":           lmk,
        "outward_code":      outward,
        "postcode":          pc,
        "address1":          row.get("address1", "").strip().upper(),
        "address2":          row.get("address2", "").strip().upper(),
        "address3":          row.get("address3", "").strip().upper(),
        "address":           row.get("address", "").strip().upper(),
        "property_type":     row.get("property-type", "").strip(),
        "built_form":        row.get("built-form", "").strip(),
        "floor_area":        floor_area,
        "number_rooms":      num_rooms,
        "energy_rating":     row.get("current-energy-rating", "").strip().upper(),
        "energy_score":      score,
        "construction_year": row.get("construction-year", "").strip(),
        "construction_age":  row.get("construction-age-band", "").strip(),
        "tenure":            row.get("tenure", "").strip(),
        "lodgement_date":    row.get("lodgement-date", "") or None,
    }


def _ingest_epc(outward: str, db_rows: list[dict]) -> None:
    """Upsert EPC rows into epc_cache. Synchronous."""
    sb = _get_sb()
    for i in range(0, len(db_rows), EPC_BATCH_SIZE):
        batch = db_rows[i:i + EPC_BATCH_SIZE]
        try:
            sb.table("epc_cache") \
                .upsert(batch, on_conflict="lmk_key") \
                .execute()
        except Exception:
            logging.exception("EPC upsert batch %d failed for %s", i // EPC_BATCH_SIZE, outward)

    try:
        sb.table("epc_cache_status").upsert({
            "outward_code": outward,
            "last_fetched": datetime.utcnow().isoformat(),
            "row_count": len(db_rows),
        }, on_conflict="outward_code").execute()
    except Exception:
        logging.exception("epc_cache_status upsert failed for %s", outward)

    logging.warning("EPC cache: ingested %d rows for %s", len(db_rows), outward)


async def ensure_epc_cache(outward: str) -> None:
    """Download + cache all EPC records for an outward code if not fresh.
    Uses a global lock so only one EPC download runs at a time,
    preventing traffic spikes on the EPC API."""
    outward = outward.strip().upper()

    # Skip if already downloading or fresh
    if outward in _epc_downloading:
        logging.warning("EPC cache: %s already downloading, skipping", outward)
        return
    fresh = await asyncio.to_thread(_is_epc_cache_fresh_sync, outward)
    if fresh:
        logging.warning("EPC cache: %s is fresh, skipping download", outward)
        return

    email = os.getenv("EPC_EMAIL", "")
    api_key = os.getenv("EPC_API_KEY", "")
    if not email or not api_key:
        logging.error("EPC cache: EPC_EMAIL / EPC_API_KEY not set, skipping")
        return

    # Acquire lock — only one EPC download at a time
    async with _epc_download_lock:
        # Re-check freshness (another task may have completed while we waited)
        fresh = await asyncio.to_thread(_is_epc_cache_fresh_sync, outward)
        if fresh:
            return
        _epc_downloading.add(outward)
        try:
            await _do_epc_download(outward, email, api_key)
        finally:
            _epc_downloading.discard(outward)


async def _do_epc_download(outward: str, email: str, api_key: str) -> None:
    """Actual EPC download logic — called under the global lock."""
    # Get all unique postcodes from our PPD cache for this outward code
    postcodes = await asyncio.to_thread(_get_ppd_postcodes_sync, outward)
    if not postcodes:
        logging.warning("EPC cache: no postcodes found in PPD cache for %s", outward)
        return

    logging.warning("EPC cache: downloading %d postcodes for %s …", len(postcodes), outward)

    # Fetch EPC data for all postcodes concurrently (semaphore-limited)
    sem = asyncio.Semaphore(EPC_CONCURRENT)
    tasks = [_fetch_epc_postcode(pc, sem, email, api_key) for pc in postcodes]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Collect all EPC rows, dedup by lmk-key (keep latest lodgement)
    seen: dict[str, dict] = {}  # lmk_key → db_row
    for result in results:
        if isinstance(result, Exception):
            continue
        for raw in result:
            db_row = _epc_row_to_db(raw, outward)
            if db_row is None:
                continue
            lmk = db_row["lmk_key"]
            # Keep the row with the latest lodgement date
            if lmk not in seen:
                seen[lmk] = db_row
            else:
                existing_date = seen[lmk].get("lodgement_date") or ""
                new_date = db_row.get("lodgement_date") or ""
                if new_date > existing_date:
                    seen[lmk] = db_row

    db_rows = list(seen.values())
    if db_rows:
        await asyncio.to_thread(_ingest_epc, outward, db_rows)
    logging.warning("EPC cache: %d unique certificates for %s", len(db_rows), outward)


def _get_ppd_postcodes_sync(outward: str) -> list[str]:
    """Get all unique postcodes from PPD cache for an outward code."""
    sb = _get_sb()
    all_pcs: set[str] = set()
    offset = 0
    while True:
        resp = sb.table("price_paid_cache") \
            .select("postcode") \
            .eq("outward_code", outward) \
            .range(offset, offset + 999) \
            .execute()
        rows = resp.data or []
        for r in rows:
            if r.get("postcode"):
                all_pcs.add(r["postcode"])
        if len(rows) < 1000:
            break
        offset += 1000
    return list(all_pcs)


def _query_epc_by_postcode_sync(postcode: str) -> list[dict]:
    """Get all cached EPC records for a postcode."""
    sb = _get_sb()
    resp = sb.table("epc_cache") \
        .select("*") \
        .eq("postcode", postcode) \
        .execute()
    return resp.data or []


async def query_epc_cached(postcode: str) -> list[dict]:
    """Get cached EPC records for a postcode (from epc_cache table)."""
    return await asyncio.to_thread(_query_epc_by_postcode_sync, postcode.strip().upper())


def _query_epc_by_outward_sync(outward: str) -> list[dict]:
    """Get all cached EPC records for an outward code (paginated past 1000 limit)."""
    sb = _get_sb()
    all_rows: list[dict] = []
    offset = 0
    while True:
        resp = sb.table("epc_cache") \
            .select("*") \
            .eq("outward_code", outward) \
            .range(offset, offset + 999) \
            .execute()
        rows = resp.data or []
        all_rows.extend(rows)
        if len(rows) < 1000:
            break
        offset += 1000
    return all_rows


async def query_epc_outward(outward: str) -> list[dict]:
    """Get all cached EPC records for an outward code."""
    return await asyncio.to_thread(_query_epc_by_outward_sync, outward.strip().upper())
