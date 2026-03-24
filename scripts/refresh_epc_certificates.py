"""
Refresh epc_certificates table from DuckDB epc table.

Source: DLUHC EPC Open Data (quarterly release)

Usage:
    cd propval-mvp
    python scripts/refresh_epc_certificates.py
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

    # Check source columns
    cols = duck.execute("SELECT * FROM epc LIMIT 0").description
    col_names = [c[0] for c in cols]
    print(f"EPC source columns: {col_names}")

    count = duck.execute("SELECT count(*) FROM epc").fetchone()[0]
    print(f"Source: {count:,} EPC records")

    pg = get_pg()
    pg.autocommit = True
    cur = pg.cursor()

    # Must drop VIEW first (depends on epc_certificates)
    print("Dropping transactions VIEW...")
    cur.execute("DROP VIEW IF EXISTS transactions")

    # Truncate and drop indexes
    print("Truncating epc_certificates...")
    cur.execute("TRUNCATE epc_certificates")
    for idx in ["idx_epc_postcode", "idx_epc_outward", "idx_epc_uprn", "idx_epc_address"]:
        cur.execute(f"DROP INDEX IF EXISTS {idx}")

    # Load from DuckDB
    print("Loading EPC certificates...")
    # Adapt column selection based on what exists in DuckDB epc table
    rows = duck.execute("""
        SELECT
            LMK_KEY, UPRN,
            POSTCODE,
            CASE WHEN POSTCODE IS NOT NULL THEN UPPER(SUBSTRING(POSTCODE, 1, LENGTH(POSTCODE) - 3)) ELSE NULL END,
            ADDRESS1, ADDRESS2, ADDRESS3,
            COALESCE(ADDRESS1,'') || ' ' || COALESCE(ADDRESS2,'') || ' ' || COALESCE(ADDRESS3,''),
            PROPERTY_TYPE, BUILT_FORM,
            CASE WHEN TOTAL_FLOOR_AREA IS NOT NULL AND TOTAL_FLOOR_AREA != ''
                 THEN CAST(TOTAL_FLOOR_AREA AS DOUBLE) ELSE NULL END,
            CASE WHEN NUMBER_HABITABLE_ROOMS IS NOT NULL AND NUMBER_HABITABLE_ROOMS != ''
                 THEN CAST(NUMBER_HABITABLE_ROOMS AS INTEGER) ELSE NULL END,
            CURRENT_ENERGY_RATING,
            CASE WHEN CURRENT_ENERGY_EFFICIENCY IS NOT NULL AND CURRENT_ENERGY_EFFICIENCY != ''
                 THEN CAST(CURRENT_ENERGY_EFFICIENCY AS INTEGER) ELSE NULL END,
            CONSTRUCTION_AGE_BAND,
            TENURE,
            LODGEMENT_DATE,
            INSPECTION_DATE,
            LOCAL_AUTHORITY
        FROM epc
    """).fetchall()

    t0 = time.time()
    total = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        args = ",".join(
            cur.mogrify(
                "(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                r,
            ).decode()
            for r in batch
        )
        cur.execute(
            f"INSERT INTO epc_certificates (lmk_key,uprn,postcode,outward_code,"
            f"address1,address2,address3,address,"
            f"property_type,built_form,floor_area_sqm,habitable_rooms,"
            f"energy_rating,energy_score,construction_age_band,"
            f"tenure,lodgement_date,inspection_date,local_authority) "
            f"VALUES {args} ON CONFLICT (lmk_key) DO NOTHING"
        )
        total += len(batch)
        if total % 100000 == 0:
            elapsed = time.time() - t0
            print(f"  {total:,} — {elapsed:.0f}s", flush=True)
        if total % 50000 == 0:
            time.sleep(PAUSE_SECONDS)

    elapsed = time.time() - t0
    print(f"Loaded {total:,} rows in {elapsed:.0f}s")

    # Recreate indexes
    print("Creating indexes...")
    cur.execute("CREATE INDEX idx_epc_postcode ON epc_certificates(postcode)")
    cur.execute("CREATE INDEX idx_epc_outward ON epc_certificates(outward_code)")
    cur.execute("CREATE INDEX idx_epc_uprn ON epc_certificates(uprn) WHERE uprn IS NOT NULL")
    cur.execute("CREATE INDEX idx_epc_address ON epc_certificates(postcode, address1, address2)")

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
    cur.execute("ANALYZE epc_certificates")

    cur.execute("SELECT count(*) FROM epc_certificates")
    print(f"Final count: {cur.fetchone()[0]:,}")

    duck.close()
    pg.close()
    print("Done!")


if __name__ == "__main__":
    main()
