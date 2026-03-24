"""
Refresh construction_age table from DuckDB construction_age table.

Source: PropVal age derivation pipeline (run after EPC refresh)

Usage:
    cd propval-mvp
    python scripts/refresh_construction_age.py
"""

import os
import sys
import time
from pathlib import Path

import duckdb
import psycopg2
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DUCKDB_PATH = Path(__file__).resolve().parent.parent / "Research" / "EPC PPD merge project" / "db" / "propval.duckdb"
BATCH_SIZE = 5000
PAUSE_SECONDS = 1.0


def get_pg():
    return psycopg2.connect(
        host="db.pphkbiogdrpdedyotkop.supabase.co",
        port=5432,
        dbname="postgres",
        user="postgres",
        password=os.environ["SUPABASE_DB_PASSWORD"],
        connect_timeout=10,
    )


def main():
    if not DUCKDB_PATH.exists():
        print(f"ERROR: DuckDB not found at {DUCKDB_PATH}")
        sys.exit(1)

    duck = duckdb.connect(str(DUCKDB_PATH), read_only=True)

    count = duck.execute("SELECT count(*) FROM construction_age WHERE age_best IS NOT NULL").fetchone()[0]
    print(f"Source: {count:,} construction_age records with age_best")

    rows = duck.execute(
        "SELECT LMK_KEY, age_best, age_source FROM construction_age WHERE age_best IS NOT NULL"
    ).fetchall()

    pg = get_pg()
    pg.autocommit = True
    cur = pg.cursor()

    # Truncate
    print("Truncating construction_age...")
    cur.execute("TRUNCATE construction_age")

    # Load
    print("Loading construction ages...")
    total = 0
    t0 = time.time()

    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        args = ",".join(
            cur.mogrify("(%s,%s,%s)", r).decode()
            for r in batch
        )
        cur.execute(
            f"INSERT INTO construction_age (lmk_key, age_best, age_source) "
            f"VALUES {args} ON CONFLICT (lmk_key) DO NOTHING"
        )
        total += len(batch)

        if total % 500000 == 0:
            elapsed = time.time() - t0
            print(f"  {total:,} — {elapsed:.0f}s", flush=True)

        if total % 100000 == 0:
            time.sleep(PAUSE_SECONDS)

    elapsed = time.time() - t0
    print(f"Loaded {total:,} rows in {elapsed:.0f}s")

    print("Running ANALYZE...")
    cur.execute("ANALYZE construction_age")

    cur.execute("SELECT count(*) FROM construction_age")
    print(f"Final count: {cur.fetchone()[0]:,}")

    duck.close()
    pg.close()
    print("Done!")


if __name__ == "__main__":
    main()
