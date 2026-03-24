"""
Refresh ppd_transactions table from DuckDB matched + unmatched tables.

Requires the DuckDB database to have been rebuilt with latest PPD + EPC data
via the matching pipeline first.

Source: HMLR Price Paid Data (monthly release)

Usage:
    cd propval-mvp
    python scripts/refresh_ppd_transactions.py
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
    if not DUCKDB_PATH.exists():
        print(f"ERROR: DuckDB not found at {DUCKDB_PATH}")
        sys.exit(1)

    duck = duckdb.connect(str(DUCKDB_PATH), read_only=True)

    # Count source rows
    matched_count = duck.execute("SELECT count(*) FROM matched").fetchone()[0]
    unmatched_count = duck.execute("SELECT count(*) FROM unmatched").fetchone()[0]
    total_expected = matched_count + unmatched_count
    print(f"Source: {matched_count:,} matched + {unmatched_count:,} unmatched = {total_expected:,} total")

    pg = get_pg()
    pg.autocommit = True
    cur = pg.cursor()

    # Drop VIEW temporarily (depends on ppd_transactions)
    print("Dropping transactions VIEW...")
    cur.execute("DROP VIEW IF EXISTS transactions")

    # Truncate and drop indexes
    print("Truncating ppd_transactions...")
    cur.execute("TRUNCATE ppd_transactions")
    for idx in [
        "idx_ppd_outward_date", "idx_ppd_postcode_date", "idx_ppd_uprn",
        "idx_ppd_hard_deck", "idx_ppd_building", "idx_ppd_street",
        "idx_ppd_postcode_saon", "idx_ppd_district", "idx_ppd_lmk_key",
    ]:
        cur.execute(f"DROP INDEX IF EXISTS {idx}")

    # Load matched records
    print("Loading matched records...")
    rows = duck.execute("""
        SELECT transaction_id, price, CAST(date_of_transfer AS VARCHAR)[:10],
               postcode, outward_code, saon, paon, street, district,
               ppd_type, duration, old_new, ppd_category,
               UPRN, LMK_KEY, lat, lon, coord_source
        FROM matched
    """).fetchall()

    t0 = time.time()
    total = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        args = ",".join(
            cur.mogrify(
                "(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                r,
            ).decode()
            for r in batch
        )
        cur.execute(
            f"INSERT INTO ppd_transactions (transaction_id,price,date_of_transfer,"
            f"postcode,outward_code,saon,paon,street,district,"
            f"ppd_type,duration,old_new,ppd_category,"
            f"uprn,lmk_key,lat,lon,coord_source) VALUES {args} "
            f"ON CONFLICT (transaction_id) DO NOTHING"
        )
        total += len(batch)
        if total % 100000 == 0:
            elapsed = time.time() - t0
            print(f"  matched: {total:,} — {elapsed:.0f}s", flush=True)
        if total % 50000 == 0:
            time.sleep(PAUSE_SECONDS)

    print(f"  Loaded {total:,} matched rows")

    # Load unmatched records
    print("Loading unmatched records...")
    rows = duck.execute("""
        SELECT transaction_id, price, CAST(date_of_transfer AS VARCHAR)[:10],
               postcode, outward_code, saon, paon, street, locality,
               ppd_type, duration, old_new, ppd_category
        FROM unmatched
    """).fetchall()

    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        args = ",".join(
            cur.mogrify("(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)", r).decode()
            for r in batch
        )
        cur.execute(
            f"INSERT INTO ppd_transactions (transaction_id,price,date_of_transfer,"
            f"postcode,outward_code,saon,paon,street,district,"
            f"ppd_type,duration,old_new,ppd_category) VALUES {args} "
            f"ON CONFLICT (transaction_id) DO NOTHING"
        )
        total += len(batch)
        if total % 50000 == 0:
            time.sleep(PAUSE_SECONDS)

    elapsed = time.time() - t0
    print(f"  Total: {total:,} rows in {elapsed:.0f}s")

    # Recreate indexes
    print("Creating indexes...")
    indexes = [
        "CREATE INDEX idx_ppd_outward_date ON ppd_transactions (outward_code, date_of_transfer DESC)",
        "CREATE INDEX idx_ppd_postcode_date ON ppd_transactions (postcode, date_of_transfer DESC)",
        "CREATE INDEX idx_ppd_uprn ON ppd_transactions (uprn) WHERE uprn IS NOT NULL",
        "CREATE INDEX idx_ppd_hard_deck ON ppd_transactions (outward_code, duration, ppd_type, date_of_transfer DESC)",
        "CREATE INDEX idx_ppd_building ON ppd_transactions (outward_code, paon) WHERE ppd_type = 'F'",
        "CREATE INDEX idx_ppd_street ON ppd_transactions (outward_code, street, date_of_transfer DESC)",
        "CREATE INDEX idx_ppd_postcode_saon ON ppd_transactions (postcode, saon, paon)",
        "CREATE INDEX idx_ppd_district ON ppd_transactions (district, date_of_transfer DESC)",
        "CREATE INDEX idx_ppd_lmk_key ON ppd_transactions (lmk_key) WHERE lmk_key IS NOT NULL",
    ]
    for sql in indexes:
        cur.execute(sql)

    # Recreate VIEW
    print("Recreating transactions VIEW...")
    cur.execute("""
        CREATE VIEW transactions AS
        SELECT
            t.transaction_id, t.price, t.date_of_transfer, t.postcode, t.outward_code,
            t.saon, t.paon, t.street, t.district, t.ppd_type, t.duration, t.old_new,
            t.ppd_category, t.uprn, t.lmk_key,
            e.property_type AS epc_property_type, e.built_form AS epc_built_form,
            e.floor_area_sqm, e.habitable_rooms, e.energy_rating, e.energy_score,
            e.construction_age_band, ca.age_best,
            COALESCE(ST_Y(c.geom), t.lat) AS lat,
            COALESCE(ST_X(c.geom), t.lon) AS lon,
            t.coord_source
        FROM ppd_transactions t
        LEFT JOIN epc_certificates e ON t.lmk_key = e.lmk_key
        LEFT JOIN construction_age ca ON t.lmk_key = ca.lmk_key
        LEFT JOIN uprn_coordinates c ON t.uprn = c.uprn
    """)

    print("Running ANALYZE...")
    cur.execute("ANALYZE ppd_transactions")

    cur.execute("SELECT count(*), sum(price) FROM ppd_transactions")
    row = cur.fetchone()
    print(f"\nFinal: {row[0]:,} rows, sum(price)={row[1]:,}")

    duck.close()
    pg.close()
    print("Done!")


if __name__ == "__main__":
    main()
