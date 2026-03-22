"""
Load deduplicated EPC addresses into epc_addresses table for fast autocomplete.
Keeps only the latest certificate per distinct address (by lodgement date).

Source: DuckDB epc table (4.4M rows) → deduplicated to ~2.5M rows
Target: Supabase epc_addresses (lightweight, 6 columns only)

Usage:
    cd propval-mvp
    python scripts/load_epc_addresses.py
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
BATCH_SIZE = 1000  # larger batches since rows are small


def main():
    if not DUCKDB_PATH.exists():
        print(f"ERROR: DuckDB not found at {DUCKDB_PATH}")
        sys.exit(1)

    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)

    print("Querying deduplicated EPC addresses from DuckDB...")
    t0 = time.time()

    # Latest certificate per distinct address (by lodgement date)
    rows = con.execute("""
        SELECT
            POSTCODE AS postcode,
            SPLIT_PART(POSTCODE, ' ', 1) AS outward_code,
            ADDRESS1 AS address1,
            ADDRESS2 AS address2,
            ADDRESS3 AS address3,
            ADDRESS AS address,
            UPRN AS uprn
        FROM (
            SELECT *, ROW_NUMBER() OVER (
                PARTITION BY POSTCODE, ADDRESS1, ADDRESS2, ADDRESS3
                ORDER BY LODGEMENT_DATETIME DESC NULLS LAST
            ) AS rn
            FROM epc
            WHERE POSTCODE IS NOT NULL AND POSTCODE != ''
        )
        WHERE rn = 1
    """).fetchall()
    con.close()

    print(f"  Fetched {len(rows):,} deduplicated addresses in {time.time()-t0:.1f}s")

    cols = ["postcode", "outward_code", "address1", "address2", "address3", "address", "uprn"]

    # Clear existing data first
    print("  Clearing existing epc_addresses data...")
    try:
        sb.table("epc_addresses").delete().neq("id", 0).execute()
    except Exception:
        pass  # Table may be empty

    inserted = 0
    errors = 0
    t1 = time.time()

    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        records = []
        for row in batch:
            d = dict(zip(cols, row))
            for k, v in d.items():
                if v == "":
                    d[k] = None
            records.append(d)
        try:
            sb.table("epc_addresses").insert(records).execute()
            inserted += len(batch)
        except Exception as e:
            errors += 1
            if errors <= 3:
                print(f"  ERROR batch {i//BATCH_SIZE}: {e}")

        if inserted % 50000 == 0 and inserted > 0:
            elapsed = time.time() - t1
            rate = inserted / elapsed
            print(f"  {inserted:,} / {len(rows):,} ({rate:.0f} rows/s)")

    elapsed = time.time() - t1
    print(f"  DONE: {inserted:,} inserted, {errors} errors in {elapsed:.1f}s")
    print(f"  Table reduction: {4436405:,} -> {inserted:,} ({(1-inserted/4436405)*100:.0f}% smaller)")


if __name__ == "__main__":
    main()
