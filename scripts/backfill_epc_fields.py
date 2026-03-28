"""
Backfill missing EPC fields in Supabase transactions table.

The bulk load only included a few EPC columns from the DuckDB matched table.
This script fills in: epc_built_form, habitable_rooms, energy_score
by looking up each transaction's lmk_key in the DuckDB epc table.

Usage:
    cd propval-mvp
    python scripts/backfill_epc_fields.py
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

    print("Querying EPC fields to backfill from DuckDB...")
    t0 = time.time()

    # Join matched with epc to get the missing fields
    rows = con.execute("""
        SELECT
            m.LMK_KEY AS lmk_key,
            e.BUILT_FORM AS epc_built_form,
            CASE
                WHEN e.NUMBER_HABITABLE_ROOMS IS NOT NULL AND e.NUMBER_HABITABLE_ROOMS != ''
                THEN CAST(e.NUMBER_HABITABLE_ROOMS AS INTEGER)
                ELSE NULL
            END AS habitable_rooms,
            CASE
                WHEN e.CURRENT_ENERGY_EFFICIENCY IS NOT NULL AND e.CURRENT_ENERGY_EFFICIENCY != ''
                THEN CAST(e.CURRENT_ENERGY_EFFICIENCY AS INTEGER)
                ELSE NULL
            END AS energy_score
        FROM matched m
        JOIN epc e ON m.LMK_KEY = e.LMK_KEY
        WHERE m.LMK_KEY IS NOT NULL AND m.LMK_KEY != ''
          AND (e.BUILT_FORM IS NOT NULL OR e.NUMBER_HABITABLE_ROOMS IS NOT NULL
               OR e.CURRENT_ENERGY_EFFICIENCY IS NOT NULL)
    """).fetchall()
    con.close()

    print(f"  Fetched {len(rows):,} rows in {time.time()-t0:.1f}s")

    updated = 0
    errors = 0
    t1 = time.time()

    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        records = []
        for lmk_key, built_form, rooms, score in batch:
            update = {"lmk_key": lmk_key}
            if built_form:
                update["epc_built_form"] = built_form
            if rooms is not None:
                update["habitable_rooms"] = rooms
            if score is not None:
                update["energy_score"] = score
            if len(update) > 1:  # more than just lmk_key
                records.append(update)

        if not records:
            continue

        try:
            # Update by lmk_key — each transaction has a unique lmk_key
            for rec in records:
                lmk = rec.pop("lmk_key")
                sb.table("transactions") \
                    .update(rec) \
                    .eq("lmk_key", lmk) \
                    .execute()
                updated += 1
        except Exception as e:
            errors += 1
            if errors <= 3:
                print(f"  ERROR batch {i//BATCH_SIZE}: {e}")

        if updated % 5000 == 0 and updated > 0:
            elapsed = time.time() - t1
            rate = updated / elapsed
            print(f"  {updated:,} / {len(rows):,} ({rate:.0f} rows/s)")
            time.sleep(0.5)  # throttle to avoid CPU burst

    elapsed = time.time() - t1
    print(f"  DONE: {updated:,} updated, {errors} errors in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
