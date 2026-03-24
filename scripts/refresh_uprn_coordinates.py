"""
Refresh uprn_coordinates table from local OS Open UPRN SQLite database.

Loads London-area UPRNs (bounding box filter) into Supabase PostGIS table.
Source: OS Open UPRN (Ordnance Survey, quarterly release)

Usage:
    cd propval-mvp
    python scripts/refresh_uprn_coordinates.py
"""

import os
import sys
import time
import sqlite3
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

UPRN_DB = Path(__file__).resolve().parent.parent / "backend" / "data" / "uprn_coords.db"
BATCH_SIZE = 2000
PAUSE_SECONDS = 1.0

# London bounding box (WGS84)
LAT_MIN, LAT_MAX = 51.28, 51.69
LON_MIN, LON_MAX = -0.51, 0.33


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
    if not UPRN_DB.exists():
        print(f"ERROR: UPRN database not found at {UPRN_DB}")
        sys.exit(1)

    # Read from SQLite
    print(f"Reading London UPRNs from {UPRN_DB.name}...")
    sqlite_conn = sqlite3.connect(str(UPRN_DB))
    sqlite_cur = sqlite_conn.cursor()
    sqlite_cur.execute(
        "SELECT uprn, lat, lon FROM uprn_coords WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?",
        (LAT_MIN, LAT_MAX, LON_MIN, LON_MAX),
    )

    # Connect to Supabase
    pg = get_pg()
    pg.autocommit = True
    cur = pg.cursor()

    # Truncate existing data
    print("Truncating uprn_coordinates...")
    cur.execute("TRUNCATE uprn_coordinates")

    # Drop indexes for faster loading
    cur.execute("DROP INDEX IF EXISTS idx_uprn_coords_geom")

    # Bulk load
    total = 0
    t0 = time.time()

    while True:
        rows = sqlite_cur.fetchmany(BATCH_SIZE)
        if not rows:
            break

        args = ",".join(
            cur.mogrify(
                "(%s, ST_SetSRID(ST_MakePoint(%s, %s), 4326))",
                (str(r[0]), r[2], r[1]),
            ).decode()
            for r in rows
        )
        cur.execute(f"INSERT INTO uprn_coordinates (uprn, geom) VALUES {args}")
        total += len(rows)

        if total % 100000 == 0:
            elapsed = time.time() - t0
            print(f"  {total:,} rows — {elapsed:.0f}s", flush=True)

        if total % 50000 == 0:
            time.sleep(PAUSE_SECONDS)

    elapsed = time.time() - t0
    print(f"\nLoaded {total:,} rows in {elapsed:.0f}s")

    # Recreate indexes
    print("Creating GiST index...")
    cur.execute("CREATE INDEX idx_uprn_coords_geom ON uprn_coordinates USING GIST (geom)")

    print("Running ANALYZE...")
    cur.execute("ANALYZE uprn_coordinates")

    # Verify
    cur.execute("SELECT count(*) FROM uprn_coordinates")
    print(f"Final count: {cur.fetchone()[0]:,}")

    cur.execute("SELECT pg_size_pretty(pg_database_size(current_database()))")
    print(f"Database size: {cur.fetchone()[0]}")

    sqlite_conn.close()
    pg.close()
    print("Done!")


if __name__ == "__main__":
    main()
