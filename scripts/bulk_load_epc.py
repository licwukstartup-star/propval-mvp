"""
Bulk-load latest EPC per UPRN from DuckDB into Supabase epc_cache.

Source: Research/EPC PPD merge project/db/propval.duckdb (epc table, 4.4M rows)
Target: Supabase epc_cache (latest EPC per UPRN only, ~2.8M rows)

Usage:
    cd propval-mvp
    python scripts/bulk_load_epc.py
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

    # Extract latest EPC per UPRN
    print("Querying latest EPC per UPRN from DuckDB...")
    t0 = time.time()
    rows = con.execute("""
        SELECT LMK_KEY, POSTCODE, ADDRESS1, ADDRESS2, ADDRESS3, ADDRESS,
               PROPERTY_TYPE, BUILT_FORM, TOTAL_FLOOR_AREA, NUMBER_HABITABLE_ROOMS,
               CURRENT_ENERGY_RATING, CURRENT_ENERGY_EFFICIENCY,
               CONSTRUCTION_AGE_BAND, TENURE, LODGEMENT_DATE, UPRN, UPRN_SOURCE
        FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY UPRN ORDER BY LODGEMENT_DATETIME DESC) as rn
            FROM epc
            WHERE UPRN IS NOT NULL AND UPRN != ''
        )
        WHERE rn = 1
    """).fetchall()
    con.close()
    print(f"  {len(rows):,} rows in {time.time() - t0:.1f}s")

    # Convert to dicts matching epc_cache schema
    print("Converting to Supabase format...")
    db_rows = []
    for r in rows:
        pc = (r[1] or "").strip()
        outward = pc.split(" ")[0] if " " in pc else pc
        db_rows.append({
            "lmk_key": r[0],
            "outward_code": outward.upper(),
            "postcode": pc.upper(),
            "address1": r[2] or "",
            "address2": r[3] or "",
            "address3": r[4] or "",
            "address": r[5] or "",
            "property_type": r[6] or "",
            "built_form": r[7] or "",
            "floor_area": float(r[8]) if r[8] else None,
            "number_rooms": int(r[9]) if r[9] else None,
            "energy_rating": r[10] or "",
            "energy_score": int(r[11]) if r[11] else None,
            "construction_year": None,
            "construction_age": r[12] or "",
            "tenure": r[13] or "",
            "lodgement_date": str(r[14]) if r[14] else None,
            "uprn": str(r[15]),
            "uprn_source": r[16] or "",
        })

    print(f"  {len(db_rows):,} rows ready")

    # Batch upsert into Supabase
    total_batches = (len(db_rows) + BATCH_SIZE - 1) // BATCH_SIZE
    uploaded = 0
    errors = 0
    t0 = time.time()

    for i in range(0, len(db_rows), BATCH_SIZE):
        batch = db_rows[i:i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        try:
            sb.table("epc_cache") \
                .upsert(batch, on_conflict="lmk_key") \
                .execute()
            uploaded += len(batch)
        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"  ERROR batch {batch_num}: {e}")

        if batch_num % 200 == 0 or batch_num == total_batches:
            elapsed = time.time() - t0
            rate = uploaded / elapsed if elapsed > 0 else 0
            pct = 100 * uploaded / len(db_rows)
            print(f"  [{pct:.1f}%] Batch {batch_num}/{total_batches} — {uploaded:,} uploaded, {errors} errors, {rate:.0f} rows/s")

    elapsed = time.time() - t0
    print(f"\nDone. {uploaded:,} rows uploaded in {elapsed:.1f}s ({errors} errors)")

    # Update epc_cache_status for all outward codes
    print("Updating epc_cache_status...")
    outward_counts: dict[str, int] = {}
    for r in db_rows:
        oc = r["outward_code"]
        outward_counts[oc] = outward_counts.get(oc, 0) + 1

    from datetime import datetime
    now = datetime.utcnow().isoformat()
    status_rows = [{"outward_code": oc, "last_fetched": now, "row_count": cnt}
                   for oc, cnt in outward_counts.items()]
    for i in range(0, len(status_rows), BATCH_SIZE):
        batch = status_rows[i:i + BATCH_SIZE]
        try:
            sb.table("epc_cache_status") \
                .upsert(batch, on_conflict="outward_code") \
                .execute()
        except Exception as e:
            print(f"  epc_cache_status error: {e}")

    print(f"  {len(outward_counts)} outward codes marked as fresh")

    # Verify
    resp = sb.table("epc_cache").select("*", count="exact").limit(0).execute()
    print(f"\nSupabase epc_cache total: {resp.count:,} rows")


if __name__ == "__main__":
    main()
