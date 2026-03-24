"""
Refresh registered_leases table from local SQLite leases database.

Source: HMLR Registered Leases (quarterly release)
Requires: leases.db built via build_leases_db.py

Usage:
    cd propval-mvp
    python scripts/refresh_registered_leases.py
"""

import os
import sys
import time
import sqlite3
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

LEASES_DB = Path(__file__).resolve().parent.parent / "backend" / "data" / "leases.db"
BATCH_SIZE = 2000
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
    if not LEASES_DB.exists():
        print(f"ERROR: Leases database not found at {LEASES_DB}")
        sys.exit(1)

    sqlite_conn = sqlite3.connect(str(LEASES_DB))
    sqlite_cur = sqlite_conn.cursor()

    # Check schema
    sqlite_cur.execute("SELECT sql FROM sqlite_master WHERE type='table' LIMIT 1")
    print(f"Source schema: {sqlite_cur.fetchone()[0]}")

    sqlite_cur.execute("SELECT count(*) FROM leases")
    count = sqlite_cur.fetchone()[0]
    print(f"Source: {count:,} lease records")

    pg = get_pg()
    pg.autocommit = True
    cur = pg.cursor()

    # Truncate
    print("Truncating registered_leases...")
    cur.execute("TRUNCATE registered_leases RESTART IDENTITY")
    cur.execute("DROP INDEX IF EXISTS idx_lease_uprn")

    # Load
    print("Loading leases...")
    sqlite_cur.execute("SELECT uprn, date_of_lease, term_years, expiry_date FROM leases")

    total = 0
    t0 = time.time()

    while True:
        rows = sqlite_cur.fetchmany(BATCH_SIZE)
        if not rows:
            break

        args = ",".join(
            cur.mogrify("(%s,%s,%s,%s)", r).decode()
            for r in rows
        )
        cur.execute(
            f"INSERT INTO registered_leases (uprn, date_of_lease, term_years, expiry_date) "
            f"VALUES {args}"
        )
        total += len(rows)

        if total % 100000 == 0:
            elapsed = time.time() - t0
            print(f"  {total:,} — {elapsed:.0f}s", flush=True)

        if total % 50000 == 0:
            time.sleep(PAUSE_SECONDS)

    elapsed = time.time() - t0
    print(f"Loaded {total:,} rows in {elapsed:.0f}s")

    # Recreate index
    print("Creating index...")
    cur.execute("CREATE INDEX idx_lease_uprn ON registered_leases (uprn)")

    print("Running ANALYZE...")
    cur.execute("ANALYZE registered_leases")

    cur.execute("SELECT count(*) FROM registered_leases")
    print(f"Final count: {cur.fetchone()[0]:,}")

    sqlite_conn.close()
    pg.close()
    print("Done!")


if __name__ == "__main__":
    main()
