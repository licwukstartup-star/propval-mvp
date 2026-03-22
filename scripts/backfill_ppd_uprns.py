"""
Backfill UPRNs into Supabase price_paid_cache from pre-matched DuckDB.

Source: Research/EPC PPD merge project/db/propval.duckdb (matched table)
Target: Supabase price_paid_cache.uprn column

Paginates by outward_code to avoid large offset queries.

Usage:
    cd propval-mvp
    python scripts/backfill_ppd_uprns.py
"""

import os
import sys
import time
from pathlib import Path

import duckdb
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DUCKDB_PATH = Path(__file__).resolve().parent.parent / "Research" / "EPC PPD merge project" / "db" / "propval.duckdb"
BATCH_SIZE = 500


def main():
    if not DUCKDB_PATH.exists():
        print(f"ERROR: DuckDB not found at {DUCKDB_PATH}")
        sys.exit(1)

    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)

    # Build lookup: transaction_id (no braces) → UPRN
    print("Reading matched table from DuckDB...")
    rows = con.execute(
        "SELECT transaction_id, UPRN FROM matched WHERE UPRN IS NOT NULL"
    ).fetchall()
    con.close()

    uprn_map: dict[str, str] = {}
    for tid, uprn in rows:
        clean_tid = tid.strip("{}")
        if clean_tid and uprn:
            uprn_map[clean_tid] = str(uprn)
    print(f"  {len(uprn_map)} mappings loaded")

    # Get all outward codes from Supabase
    oc_resp = sb.table("ppd_cache_status").select("outward_code").execute()
    outward_codes = sorted(r["outward_code"] for r in oc_resp.data)
    print(f"  {len(outward_codes)} outward codes to process")

    total_updated = 0
    total_skipped = 0
    total_errors = 0
    t0 = time.time()

    for oc_idx, oc in enumerate(outward_codes):
        # Read all rows for this outward code that don't have UPRN
        oc_rows: list[dict] = []
        offset = 0
        while True:
            resp = sb.table("price_paid_cache") \
                .select("*") \
                .eq("outward_code", oc) \
                .is_("uprn", "null") \
                .range(offset, offset + 999) \
                .execute()
            batch = resp.data or []
            oc_rows.extend(batch)
            if len(batch) < 1000:
                break
            offset += 1000

        if not oc_rows:
            continue

        # Match and upsert
        to_upsert = []
        skipped = 0
        for r in oc_rows:
            uprn = uprn_map.get(r["transaction_id"])
            if uprn:
                r["uprn"] = uprn
                to_upsert.append(r)
            else:
                skipped += 1

        total_skipped += skipped

        for i in range(0, len(to_upsert), BATCH_SIZE):
            batch = to_upsert[i:i + BATCH_SIZE]
            try:
                sb.table("price_paid_cache") \
                    .upsert(batch, on_conflict="transaction_id") \
                    .execute()
                total_updated += len(batch)
            except Exception as e:
                total_errors += 1
                if total_errors <= 5:
                    print(f"  ERROR ({oc}): {e}")

        elapsed = time.time() - t0
        rate = total_updated / elapsed if elapsed > 0 else 0
        print(f"  [{oc_idx + 1}/{len(outward_codes)}] {oc}: +{len(to_upsert)} updated, +{skipped} skipped | Total: {total_updated} updated, {rate:.0f} rows/s")

    elapsed = time.time() - t0
    print(f"\nDone. {total_updated} updated, {total_skipped} unmatched, {total_errors} errors in {elapsed:.1f}s")

    resp = sb.table("price_paid_cache").select("*", count="exact").not_.is_("uprn", "null").limit(0).execute()
    print(f"Supabase price_paid_cache rows with UPRN: {resp.count}")


if __name__ == "__main__":
    main()
