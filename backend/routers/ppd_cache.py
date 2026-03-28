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
import re
import threading
from datetime import date, datetime, timedelta

import httpx
from rapidfuzz import fuzz
from supabase import create_client

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

HMLR_CSV_URL = "https://landregistry.data.gov.uk/app/ppd/ppd_data.csv"
CACHE_MAX_AGE_DAYS = 30          # re-download after this many days
DOWNLOAD_TIMEOUT   = 60.0        # seconds for HMLR CSV download
BATCH_SIZE         = 500         # rows per Supabase upsert call

# Storage budget — Supabase free tier is 500MB
STORAGE_LIMIT_MB        = 500
STORAGE_EVICT_THRESHOLD = 0.90   # evict when estimated usage exceeds 90%
BYTES_PER_PPD_ROW       = 300    # estimated average row size in price_paid_cache
BYTES_PER_EPC_ROW       = 400    # estimated average row size in epc_cache

# CSV columns (with header=true)
CSV_COLS = [
    "unique_id", "price_paid", "deed_date", "postcode", "property_type",
    "new_build", "estate_type", "saon", "paon", "street", "locality",
    "town", "district", "county", "transaction_category", "linked_data_uri",
]


# ---------------------------------------------------------------------------
# Supabase client (singleton)
# ---------------------------------------------------------------------------

_epc_download_lock = asyncio.Lock()       # only one EPC download at a time
_epc_downloading: set[str] = set()        # outward codes currently downloading
_epc_events: dict[str, asyncio.Event] = {}  # outward → Event (set when download done)

def _get_sb():
    from services.supabase_admin import require_service_client
    return require_service_client()


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
            "uprn": None,  # resolved later via EPC matching
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


_eviction_lock = threading.Lock()


def _evict_oldest_sync(keep_outward: str | None = None) -> bool:
    """Evict oldest cached PPD outward codes until estimated storage drops below 90%.

    Returns True if storage is within budget (safe to ingest), False if eviction
    failed (caller must NOT ingest new data).

    EPC bulk cache is excluded — it is bulk-loaded once and never evicted.
    """
    if not _eviction_lock.acquire(blocking=False):
        logging.warning("PPD eviction: already in progress, skipping")
        return False
    try:
        return _evict_oldest_inner(keep_outward)
    finally:
        _eviction_lock.release()


def _evict_oldest_inner(keep_outward: str | None = None) -> bool:
    """Inner eviction logic (must be called under _eviction_lock)."""
    sb = _get_sb()
    limit_bytes = STORAGE_LIMIT_MB * 1024 * 1024
    threshold_bytes = int(limit_bytes * STORAGE_EVICT_THRESHOLD)

    # Gather PPD row counts (EPC excluded — never evicted)
    ppd_status = sb.table("ppd_cache_status") \
        .select("outward_code,row_count,last_fetched") \
        .order("last_fetched", desc=False) \
        .execute()
    ppd_rows = {r["outward_code"]: r["row_count"] for r in (ppd_status.data or [])}
    ppd_order = [r["outward_code"] for r in (ppd_status.data or [])]

    # Estimate PPD-only storage (EPC is bulk-loaded separately, not counted)
    total_bytes = sum(ppd_rows.values()) * BYTES_PER_PPD_ROW

    if total_bytes < threshold_bytes:
        return True  # no eviction needed

    est_mb = total_bytes / (1024 * 1024)
    logging.warning("PPD cache eviction: estimated %.0fMB (threshold %.0fMB), evicting oldest codes",
                    est_mb, threshold_bytes / (1024 * 1024))

    # Evict oldest-fetched PPD codes first until under threshold
    for oc in ppd_order:
        if total_bytes < threshold_bytes:
            break
        if oc == keep_outward:
            continue

        freed = ppd_rows.get(oc, 0) * BYTES_PER_PPD_ROW
        try:
            sb.table("price_paid_cache").delete().eq("outward_code", oc).execute()
            sb.table("ppd_cache_status").delete().eq("outward_code", oc).execute()
        except Exception:
            logging.exception("PPD eviction failed for %s — aborting eviction to prevent cascade", oc)
            return False  # ABORT: don't continue silently, don't let caller ingest

        total_bytes -= freed
        logging.warning("PPD cache eviction: dropped %s (freed ~%.1fMB, remaining ~%.0fMB)",
                        oc, freed / (1024 * 1024), total_bytes / (1024 * 1024))

    return total_bytes < threshold_bytes


async def ensure_cache(outward: str) -> None:
    """No-op: spine tables contain all pre-loaded data.
    Kept for API compatibility with comparable search engine.
    """
    return


async def _ensure_cache_legacy(outward: str) -> None:
    """Legacy: download PPD from HMLR on demand. Retained for non-spine fallback."""
    outward = outward.strip().upper()
    fresh = await asyncio.to_thread(_is_cache_fresh_sync, outward)
    if not fresh:
        eviction_ok = await asyncio.to_thread(_evict_oldest_sync, outward)
        if not eviction_ok:
            logging.warning("PPD cache: skipping ingest for %s — eviction failed or in progress", outward)
            return
        rows = await _download_csv(outward)
        if rows:
            await asyncio.to_thread(_ingest, outward, rows)
    else:
        logging.warning("PPD cache: %s is fresh, skipping download", outward)


async def ensure_cache_with_epc(outward: str) -> None:
    """No-op: spine tables contain all pre-loaded data."""
    return


async def _ensure_epc_background(outward: str) -> None:
    """No-op: spine tables contain all pre-loaded EPC data."""
    return


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
# Spine column mapping: transactions → price_paid_cache format
# ---------------------------------------------------------------------------

_SPINE_SELECT = (
    "transaction_id, price, date_of_transfer, postcode, outward_code, "
    "saon, paon, street, district, ppd_type, duration, old_new, ppd_category, "
    "uprn, lmk_key, epc_property_type, epc_built_form, floor_area_sqm, "
    "habitable_rooms, energy_rating, energy_score, construction_age_band, "
    "age_best, lat, lon, coord_source"
)


def _spine_to_ppd_format(row: dict) -> dict:
    """Map a spine transactions row to price_paid_cache column names."""
    return {
        "transaction_id":       row.get("transaction_id"),
        "deed_date":            str(row.get("date_of_transfer") or "")[:10],
        "price_paid":           row.get("price"),
        "postcode":             row.get("postcode"),
        "outward_code":         row.get("outward_code"),
        "saon":                 row.get("saon"),
        "paon":                 row.get("paon"),
        "street":               row.get("street"),
        "district":             row.get("district"),
        "property_type":        row.get("ppd_type"),
        "estate_type":          row.get("duration"),
        "new_build":            "Y" if row.get("old_new") == "Y" else "N",
        "transaction_category": row.get("ppd_category"),
        "uprn":                 row.get("uprn"),
        # Pre-enriched EPC fields (skip EPC API calls)
        "lmk_key":              row.get("lmk_key"),
        "epc_property_type":    row.get("epc_property_type"),
        "epc_built_form":       row.get("epc_built_form"),
        "habitable_rooms":      row.get("habitable_rooms"),
        "floor_area_sqm":       row.get("floor_area_sqm"),
        "energy_rating":        row.get("energy_rating"),
        "energy_score":         row.get("energy_score"),
        "construction_age_band": row.get("construction_age_band"),
        "age_best":             row.get("age_best"),
        "lat":                  row.get("lat"),
        "lon":                  row.get("lon"),
        "coord_source":         row.get("coord_source"),
    }


def _spine_rows(rows: list[dict]) -> list[dict]:
    """Convert a list of spine rows to PPD cache format."""
    return [_spine_to_ppd_format(r) for r in rows]


# ---------------------------------------------------------------------------
# Sync query helpers (run via asyncio.to_thread)
# Now query spine `transactions` table instead of `price_paid_cache`
# ---------------------------------------------------------------------------

def _query_postcode_sync(pc: str, date_from: str) -> list[dict]:
    sb = _get_sb()
    resp = sb.table("transactions") \
        .select(_SPINE_SELECT) \
        .eq("postcode", pc) \
        .gte("date_of_transfer", date_from) \
        .execute()
    return _spine_rows(resp.data or [])


def _query_building_sync(outward: str, bldg: str, date_from: str) -> list[dict]:
    sb = _get_sb()
    # Query 1: PAON starts with building name (e.g. "QUEENS WHARF" or "QUEENS WHARF, 2")
    resp1 = sb.table("transactions") \
        .select(_SPINE_SELECT) \
        .eq("outward_code", outward) \
        .ilike("paon", f"{bldg}%") \
        .gte("date_of_transfer", date_from) \
        .execute()
    # Query 2: PAON contains building name after a number prefix (e.g. "2 QUEENS WHARF")
    resp2 = sb.table("transactions") \
        .select(_SPINE_SELECT) \
        .eq("outward_code", outward) \
        .ilike("paon", f"% {bldg}%") \
        .gte("date_of_transfer", date_from) \
        .execute()
    # Dedup by transaction_id
    seen: set[str] = set()
    rows: list[dict] = []
    for r in (resp1.data or []) + (resp2.data or []):
        tid = r.get("transaction_id", "")
        if tid and tid not in seen:
            seen.add(tid)
            rows.append(r)
    return _spine_rows(rows)


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
    resp = sb.table("transactions") \
        .select("paon") \
        .eq("outward_code", outward) \
        .gte("date_of_transfer", date_from) \
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

    # Fetch transactions for all matching PAONs in a single batch query
    rows: list[dict] = []
    seen: set[str] = set()
    resp2 = sb.table("transactions") \
        .select(_SPINE_SELECT) \
        .eq("outward_code", outward) \
        .in_("paon", matching_paons) \
        .gte("date_of_transfer", date_from) \
        .execute()
    for r in (resp2.data or []):
        tid = r.get("transaction_id", "")
        if tid and tid not in seen:
            seen.add(tid)
            rows.append(r)
    return _spine_rows(rows)


def _normalise_paon_hyphen(paon: str) -> list[str]:
    """Return variant PAON strings to handle whitespace around hyphens.
    PPD stores "101 - 103" (spaced) but EPC often gives "101-103" (compact).
    Returns a deduplicated list of variants to try.
    """
    import re
    variants = {paon}
    # Spaced form: "101 - 103"
    variants.add(re.sub(r"\s*-\s*", " - ", paon))
    # Compact form: "101-103"
    variants.add(re.sub(r"\s*-\s*", "-", paon))
    return list(variants)


def _query_paon_street_sync(outward: str, paon: str, street: str, date_from: str) -> list[dict]:
    sb = _get_sb()
    paon_variants = _normalise_paon_hyphen(paon)
    seen: set[str] = set()
    rows: list[dict] = []
    for pv in paon_variants:
        resp = sb.table("transactions") \
            .select(_SPINE_SELECT) \
            .eq("outward_code", outward) \
            .eq("paon", pv) \
            .eq("street", street) \
            .gte("date_of_transfer", date_from) \
            .execute()
        for r in (resp.data or []):
            tid = r.get("transaction_id", "")
            if tid and tid not in seen:
                seen.add(tid)
                rows.append(r)
    return _spine_rows(rows)


def _query_street_sync(outward: str, street: str, date_from: str) -> list[dict]:
    """All transactions on a specific street within an outward code."""
    sb = _get_sb()
    resp = sb.table("transactions") \
        .select(_SPINE_SELECT) \
        .eq("outward_code", outward) \
        .eq("street", street) \
        .gte("date_of_transfer", date_from) \
        .limit(10000) \
        .execute()
    return _spine_rows(resp.data or [])


def _query_outward_sync(outward: str, date_from: str) -> list[dict]:
    sb = _get_sb()
    resp = sb.table("transactions") \
        .select(_SPINE_SELECT) \
        .eq("outward_code", outward) \
        .gte("date_of_transfer", date_from) \
        .execute()
    return _spine_rows(resp.data or [])


def _query_postcode_all_sync(pc: str) -> list[dict]:
    sb = _get_sb()
    resp = sb.table("transactions") \
        .select(_SPINE_SELECT) \
        .eq("postcode", pc) \
        .order("date_of_transfer", desc=True) \
        .execute()
    return _spine_rows(resp.data or [])


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


async def query_by_uprn(uprn: str, saon: str | None = None) -> list[dict]:
    """All transactions for a UPRN — instant lookup, no address matching needed.
    Optional saon filter handles building-level UPRNs shared across flats."""
    if not uprn:
        return []

    def _query():
        sb = _get_sb()
        resp = sb.table("transactions") \
            .select(_SPINE_SELECT) \
            .eq("uprn", str(uprn)) \
            .order("date_of_transfer", desc=True) \
            .limit(100) \
            .execute()
        return _spine_rows(resp.data or [])

    rows = await asyncio.to_thread(_query)
    logging.warning("PPD query UPRN %s → %d rows", uprn, len(rows))

    # Filter by SAON if provided (building-level UPRNs can return all flats)
    if saon and rows:
        import re as _re
        saon_upper = saon.strip().upper()
        variants = {saon_upper}
        if saon_upper.startswith("FLAT "):
            variants.add("APARTMENT " + saon_upper[5:])
        elif saon_upper.startswith("APARTMENT "):
            variants.add("FLAT " + saon_upper[10:])
        elif saon_upper.startswith("APT "):
            variants.add("FLAT " + saon_upper[4:])
        m = _re.search(r"(\d+\w*)", saon_upper)
        if m:
            variants.add(m.group(1))
        filtered = [r for r in rows if (r.get("saon") or "").strip().upper() in variants]
        if filtered:
            rows = filtered
            logging.warning("PPD UPRN %s filtered by SAON %s → %d rows", uprn, saon, len(rows))

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
    transaction_category TEXT,  -- A/B
    uprn             TEXT       -- resolved via EPC matching
);

CREATE INDEX IF NOT EXISTS idx_ppc_outward   ON price_paid_cache (outward_code);
CREATE INDEX IF NOT EXISTS idx_ppc_postcode  ON price_paid_cache (postcode);
CREATE INDEX IF NOT EXISTS idx_ppc_date      ON price_paid_cache (deed_date);
CREATE INDEX IF NOT EXISTS idx_ppc_paon_str  ON price_paid_cache (outward_code, paon, street);
CREATE INDEX IF NOT EXISTS idx_ppc_uprn      ON price_paid_cache (uprn) WHERE uprn IS NOT NULL;

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
    "lodgement-date", "uprn", "uprn-source",
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
        "uprn":              row.get("uprn", "") or None,
        "uprn_source":       row.get("uprn-source", "") or None,
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
    preventing traffic spikes on the EPC API.
    Concurrent callers for the same outward code block until the download
    finishes (instead of silently skipping)."""
    outward = outward.strip().upper()

    # If another coroutine is already downloading this code, wait for it
    if outward in _epc_downloading:
        evt = _epc_events.get(outward)
        if evt:
            logging.warning("EPC cache: %s already downloading, waiting …", outward)
            await evt.wait()
            return
        # Event missing (shouldn't happen) — fall through to lock
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
        _epc_events[outward] = asyncio.Event()
        try:
            await _do_epc_download(outward, email, api_key)
            # Resolve PPD UPRNs using freshly downloaded EPC data
            await asyncio.to_thread(_resolve_ppd_uprns_sync, outward)
        finally:
            _epc_downloading.discard(outward)
            evt = _epc_events.pop(outward, None)
            if evt:
                evt.set()  # wake all waiters


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


# ---------------------------------------------------------------------------
# PPD → EPC UPRN resolution
# ---------------------------------------------------------------------------

def _normalise_addr(s: str) -> str:
    """Collapse address to uppercase alphanumeric tokens for fast comparison."""
    return re.sub(r"[^A-Z0-9 ]", "", s.upper()).strip()


def _resolve_ppd_uprns_sync(outward: str) -> int:
    """Match price_paid_cache rows to epc_cache by address, write resolved UPRNs.

    Two-pass strategy: (1) exact normalised address lookup, then
    (2) fuzzy matching (≥60 score) for unmatched rows.
    Returns count of newly resolved rows.
    """
    sb = _get_sb()

    # 1. Load EPC rows with UPRN for this outward code
    resp = sb.table("epc_cache") \
        .select("postcode, address1, address2, address3, uprn") \
        .eq("outward_code", outward) \
        .not_.is_("uprn", "null") \
        .limit(10000) \
        .execute()
    epc_rows: list[dict] = resp.data or []

    if not epc_rows:
        logging.warning("PPD UPRN resolve: no EPC rows with UPRN for %s", outward)
        return 0

    # Build EPC index: (postcode, normalised_address) → uprn
    epc_exact: dict[tuple[str, str], str] = {}
    epc_by_pc: dict[str, list[tuple[str, str]]] = {}  # pc → [(norm_addr, uprn)]
    for e in epc_rows:
        pc = e.get("postcode", "")
        uprn = e.get("uprn", "")
        epc_addr = _normalise_addr(" ".join(filter(None, [
            e.get("address1", ""), e.get("address2", ""), e.get("address3", ""),
        ])))
        if pc and epc_addr and uprn:
            epc_exact[(pc, epc_addr)] = uprn
            if pc not in epc_by_pc:
                epc_by_pc[pc] = []
            epc_by_pc[pc].append((epc_addr, uprn))

    # 2. Load PPD rows without UPRN for this outward code
    resp = sb.table("price_paid_cache") \
        .select("transaction_id, postcode, saon, paon, street") \
        .eq("outward_code", outward) \
        .is_("uprn", "null") \
        .limit(10000) \
        .execute()
    ppd_rows: list[dict] = resp.data or []

    if not ppd_rows:
        logging.warning("PPD UPRN resolve: all PPD rows already have UPRN for %s", outward)
        return 0

    # 3. Two-pass matching
    resolved: dict[str, str] = {}  # transaction_id → uprn
    fuzzy_queue: list[tuple[str, str, str]] = []  # (tid, ppd_addr, pc)

    # Pass 1: exact
    for r in ppd_rows:
        tid = r.get("transaction_id", "")
        pc = r.get("postcode", "")
        ppd_addr = _normalise_addr(" ".join(filter(None, [
            r.get("saon", ""), r.get("paon", ""), r.get("street", ""),
        ])))
        if not ppd_addr or not pc:
            continue
        uprn = epc_exact.get((pc, ppd_addr))
        if uprn:
            resolved[tid] = uprn
        else:
            fuzzy_queue.append((tid, ppd_addr, pc))

    # Pass 2: fuzzy
    for tid, ppd_addr, pc in fuzzy_queue:
        candidates = epc_by_pc.get(pc, [])
        if not candidates:
            continue
        best_score = 0
        best_uprn = None
        for epc_addr, uprn in candidates:
            score = fuzz.token_sort_ratio(ppd_addr, epc_addr)
            if score > best_score:
                best_score = score
                best_uprn = uprn
        if best_score >= 60 and best_uprn:
            resolved[tid] = best_uprn

    if not resolved:
        logging.warning("PPD UPRN resolve: 0 matches for %s (%d PPD rows checked)", outward, len(ppd_rows))
        return 0

    # 4. Batch-update resolved UPRNs
    updates = [{"transaction_id": tid, "uprn": uprn} for tid, uprn in resolved.items()]
    for i in range(0, len(updates), BATCH_SIZE):
        batch = updates[i:i + BATCH_SIZE]
        try:
            sb.table("price_paid_cache") \
                .upsert(batch, on_conflict="transaction_id") \
                .execute()
        except Exception:
            logging.exception("PPD UPRN update batch %d failed for %s", i // BATCH_SIZE, outward)

    logging.warning("PPD UPRN resolve: %d/%d matched for %s", len(resolved), len(ppd_rows), outward)
    return len(resolved)


def _get_ppd_postcodes_sync(outward: str) -> list[str]:
    """Get all unique postcodes from spine transactions for an outward code."""
    sb = _get_sb()
    resp = sb.table("transactions") \
        .select("postcode") \
        .eq("outward_code", outward) \
        .limit(10000) \
        .execute()
    all_pcs: set[str] = set()
    for r in (resp.data or []):
        if r.get("postcode"):
            all_pcs.add(r["postcode"])
    return list(all_pcs)


def _query_epc_by_postcode_sync(postcode: str) -> list[dict]:
    """Get all EPC records for a postcode from spine epc_certificates table."""
    sb = _get_sb()
    resp = sb.table("epc_certificates") \
        .select("*") \
        .eq("postcode", postcode) \
        .execute()
    return resp.data or []


async def query_epc_cached(postcode: str) -> list[dict]:
    """Get cached EPC records for a postcode (from epc_cache table)."""
    return await asyncio.to_thread(_query_epc_by_postcode_sync, postcode.strip().upper())


_EPC_OUTWARD_COLS = (
    "postcode,address1,address2,address3,"
    "habitable_rooms,floor_area_sqm,energy_rating,energy_score,"
    "construction_year,construction_age_band,property_type,built_form,"
    "uprn,uprn_source,lodgement_date"
)


def _query_epc_by_outward_sync(outward: str) -> list[dict]:
    """Get EPC records for an outward code from spine epc_certificates."""
    sb = _get_sb()
    resp = sb.table("epc_certificates") \
        .select(_EPC_OUTWARD_COLS) \
        .eq("outward_code", outward) \
        .limit(10000) \
        .execute()
    return resp.data or []


def _query_epc_outward_multi_sync(outward_codes: list[str]) -> list[dict]:
    """Get EPC records for multiple outward codes from spine epc_certificates."""
    sb = _get_sb()
    resp = sb.table("epc_certificates") \
        .select(_EPC_OUTWARD_COLS) \
        .in_("outward_code", outward_codes) \
        .limit(15000) \
        .execute()
    return resp.data or []


async def query_epc_outward(outward: str) -> list[dict]:
    """Get all cached EPC records for an outward code."""
    return await asyncio.to_thread(_query_epc_by_outward_sync, outward.strip().upper())


async def query_epc_outward_multi(outward_codes: list[str]) -> list[dict]:
    """Get all cached EPC records for multiple outward codes — single SQL round trip."""
    if not outward_codes:
        return []
    codes = [oc.strip().upper() for oc in outward_codes]
    return await asyncio.to_thread(_query_epc_outward_multi_sync, codes)
