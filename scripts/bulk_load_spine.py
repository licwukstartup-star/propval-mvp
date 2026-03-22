"""
Bulk-load PropVal spine tables from local DuckDB + SQLite into Supabase.

Sources:
  - DuckDB matched   → Supabase transactions
  - DuckDB unmatched → Supabase unmatched_transactions
  - DuckDB epc + construction_age → Supabase epc_certificates
  - SQLite leases.db  → Supabase registered_leases

Usage:
    cd propval-mvp
    python scripts/bulk_load_spine.py [--table transactions|epc|unmatched|leases|all]
"""

import os
import sys
import time
import sqlite3
import argparse
from datetime import date
from pathlib import Path

import duckdb
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DUCKDB_PATH = Path(__file__).resolve().parent.parent / "Research" / "EPC PPD merge project" / "db" / "propval.duckdb"
LEASES_PATH = Path(__file__).resolve().parent.parent / "backend" / "data" / "leases.db"
BATCH_SIZE = 500
SPINE_VERSION = date.today().isoformat()


def get_supabase():
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


def load_transactions(sb, con):
    """Load DuckDB matched table → Supabase transactions."""
    print("Loading transactions from DuckDB matched table...")
    t0 = time.time()

    # Join matched with construction_age for age fields
    rows = con.execute("""
        SELECT
            m.transaction_id,
            m.price,
            CAST(m.date_of_transfer AS VARCHAR)[:10] AS date_of_transfer,
            m.postcode,
            m.outward_code,
            m.saon,
            m.paon,
            m.street,
            m.district,
            m.ppd_type,
            m.duration,
            m.old_new,
            m.ppd_category,
            m.UPRN AS uprn,
            CASE
                WHEN m.UPRN IS NOT NULL AND m.UPRN != '' THEN 'epc_match'
                ELSE NULL
            END AS uprn_source,
            m.LMK_KEY AS lmk_key,
            m.epc_type AS epc_property_type,
            NULL AS epc_built_form,
            CASE
                WHEN m.TOTAL_FLOOR_AREA IS NOT NULL AND m.TOTAL_FLOOR_AREA != ''
                THEN CAST(m.TOTAL_FLOOR_AREA AS DOUBLE)
                ELSE NULL
            END AS floor_area_sqm,
            NULL AS habitable_rooms,
            m.CURRENT_ENERGY_RATING AS energy_rating,
            NULL AS energy_score,
            m.CONSTRUCTION_AGE_BAND AS construction_age_band,
            ca.age_best,
            CASE WHEN ca.age_estimated = 1 THEN true ELSE false END AS age_estimated,
            ca.age_source,
            m.lat,
            m.lon,
            m.coord_source
        FROM matched m
        LEFT JOIN construction_age ca ON m.LMK_KEY = ca.LMK_KEY
    """).fetchall()

    print(f"  Fetched {len(rows):,} rows in {time.time()-t0:.1f}s")

    cols = [
        "transaction_id", "price", "date_of_transfer", "postcode", "outward_code",
        "saon", "paon", "street", "district", "ppd_type", "duration", "old_new",
        "ppd_category", "uprn", "uprn_source", "lmk_key", "epc_property_type",
        "epc_built_form", "floor_area_sqm", "habitable_rooms", "energy_rating",
        "energy_score", "construction_age_band", "age_best", "age_estimated",
        "age_source", "lat", "lon", "coord_source",
    ]

    inserted = 0
    errors = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        records = []
        for row in batch:
            d = dict(zip(cols, row))
            d["spine_version"] = SPINE_VERSION
            # Clean empty strings to None
            for k, v in d.items():
                if v == "":
                    d[k] = None
            records.append(d)
        try:
            sb.table("transactions").upsert(records, on_conflict="transaction_id").execute()
            inserted += len(batch)
        except Exception as e:
            errors += 1
            print(f"  ERROR batch {i//BATCH_SIZE}: {e}")
        if inserted % 10000 == 0 and inserted > 0:
            elapsed = time.time() - t0
            rate = inserted / elapsed
            print(f"  {inserted:,} / {len(rows):,} ({rate:.0f} rows/s)")

    elapsed = time.time() - t0
    print(f"  DONE: {inserted:,} inserted, {errors} errors in {elapsed:.1f}s")


def load_epc_certificates(sb, con):
    """Load DuckDB epc + construction_age → Supabase epc_certificates."""
    print("Loading epc_certificates from DuckDB epc table...")
    t0 = time.time()

    rows = con.execute("""
        SELECT
            e.LMK_KEY AS lmk_key,
            e.UPRN AS uprn,
            e.UPRN_SOURCE AS uprn_source,
            e.POSTCODE AS postcode,
            SPLIT_PART(e.POSTCODE, ' ', 1) AS outward_code,
            e.ADDRESS1 AS address1,
            e.ADDRESS2 AS address2,
            e.ADDRESS3 AS address3,
            e.ADDRESS AS address,
            e.PROPERTY_TYPE AS property_type,
            e.BUILT_FORM AS built_form,
            CASE
                WHEN e.TOTAL_FLOOR_AREA IS NOT NULL AND e.TOTAL_FLOOR_AREA != ''
                THEN CAST(e.TOTAL_FLOOR_AREA AS DOUBLE)
                ELSE NULL
            END AS floor_area_sqm,
            CASE
                WHEN e.NUMBER_HABITABLE_ROOMS IS NOT NULL AND e.NUMBER_HABITABLE_ROOMS != ''
                THEN CAST(e.NUMBER_HABITABLE_ROOMS AS INTEGER)
                ELSE NULL
            END AS habitable_rooms,
            e.CURRENT_ENERGY_RATING AS energy_rating,
            CASE
                WHEN e.CURRENT_ENERGY_EFFICIENCY IS NOT NULL AND e.CURRENT_ENERGY_EFFICIENCY != ''
                THEN CAST(e.CURRENT_ENERGY_EFFICIENCY AS INTEGER)
                ELSE NULL
            END AS energy_score,
            e.CONSTRUCTION_AGE_BAND AS construction_age_band,
            NULL AS construction_year,
            e.TENURE AS tenure,
            CASE
                WHEN e.LODGEMENT_DATE IS NOT NULL AND e.LODGEMENT_DATE != ''
                THEN CAST(e.LODGEMENT_DATE AS DATE)
                ELSE NULL
            END AS lodgement_date,
            CASE
                WHEN e.INSPECTION_DATE IS NOT NULL AND e.INSPECTION_DATE != ''
                THEN CAST(e.INSPECTION_DATE AS DATE)
                ELSE NULL
            END AS inspection_date,
            e.LOCAL_AUTHORITY AS local_authority,
            ca.age_best,
            CASE WHEN ca.age_estimated = 1 THEN true ELSE false END AS age_estimated,
            ca.age_source
        FROM epc e
        LEFT JOIN construction_age ca ON e.LMK_KEY = ca.LMK_KEY
    """).fetchall()

    print(f"  Fetched {len(rows):,} rows in {time.time()-t0:.1f}s")

    cols = [
        "lmk_key", "uprn", "uprn_source", "postcode", "outward_code",
        "address1", "address2", "address3", "address", "property_type",
        "built_form", "floor_area_sqm", "habitable_rooms", "energy_rating",
        "energy_score", "construction_age_band", "construction_year", "tenure",
        "lodgement_date", "inspection_date", "local_authority",
        "age_best", "age_estimated", "age_source",
    ]

    inserted = 0
    errors = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        records = []
        for row in batch:
            d = dict(zip(cols, row))
            d["spine_version"] = SPINE_VERSION
            for k, v in d.items():
                if v == "":
                    d[k] = None
                # Convert date objects to string for JSON
                if hasattr(v, "isoformat"):
                    d[k] = v.isoformat()
            records.append(d)
        try:
            sb.table("epc_certificates").upsert(records, on_conflict="lmk_key").execute()
            inserted += len(batch)
        except Exception as e:
            errors += 1
            print(f"  ERROR batch {i//BATCH_SIZE}: {e}")
        if inserted % 10000 == 0 and inserted > 0:
            elapsed = time.time() - t0
            rate = inserted / elapsed
            print(f"  {inserted:,} / {len(rows):,} ({rate:.0f} rows/s)")

    elapsed = time.time() - t0
    print(f"  DONE: {inserted:,} inserted, {errors} errors in {elapsed:.1f}s")


def load_unmatched(sb, con):
    """Load DuckDB unmatched → Supabase unmatched_transactions."""
    print("Loading unmatched_transactions from DuckDB...")
    t0 = time.time()

    rows = con.execute("""
        SELECT
            transaction_id,
            price,
            CAST(date_of_transfer AS VARCHAR)[:10] AS date_of_transfer,
            postcode,
            SPLIT_PART(postcode, ' ', 1) AS outward_code,
            saon,
            paon,
            street,
            locality,
            town,
            district,
            county,
            property_type AS ppd_type,
            duration,
            old_new,
            ppd_category
        FROM unmatched
    """).fetchall()

    print(f"  Fetched {len(rows):,} rows in {time.time()-t0:.1f}s")

    cols = [
        "transaction_id", "price", "date_of_transfer", "postcode", "outward_code",
        "saon", "paon", "street", "locality", "town", "district", "county",
        "ppd_type", "duration", "old_new", "ppd_category",
    ]

    inserted = 0
    errors = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        records = []
        for row in batch:
            d = dict(zip(cols, row))
            d["spine_version"] = SPINE_VERSION
            for k, v in d.items():
                if v == "":
                    d[k] = None
            records.append(d)
        try:
            sb.table("unmatched_transactions").upsert(records, on_conflict="transaction_id").execute()
            inserted += len(batch)
        except Exception as e:
            errors += 1
            print(f"  ERROR batch {i//BATCH_SIZE}: {e}")
        if inserted % 5000 == 0 and inserted > 0:
            print(f"  {inserted:,} / {len(rows):,}")

    elapsed = time.time() - t0
    print(f"  DONE: {inserted:,} inserted, {errors} errors in {elapsed:.1f}s")


def load_leases(sb):
    """Load SQLite leases.db → Supabase registered_leases."""
    print("Loading registered_leases from leases.db...")
    if not LEASES_PATH.exists():
        print(f"  ERROR: {LEASES_PATH} not found")
        return

    t0 = time.time()
    lcon = sqlite3.connect(str(LEASES_PATH))
    rows = lcon.execute("SELECT uprn, date_of_lease, term_years, expiry_date FROM registered_leases").fetchall()
    lcon.close()

    print(f"  Fetched {len(rows):,} rows in {time.time()-t0:.1f}s")

    inserted = 0
    errors = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        records = []
        for uprn, date_of_lease, term_years, expiry_date in batch:
            records.append({
                "uprn": uprn,
                "date_of_lease": date_of_lease if date_of_lease else None,
                "term_years": term_years,
                "expiry_date": expiry_date if expiry_date else None,
                "spine_version": SPINE_VERSION,
            })
        try:
            sb.table("registered_leases").insert(records).execute()
            inserted += len(batch)
        except Exception as e:
            errors += 1
            print(f"  ERROR batch {i//BATCH_SIZE}: {e}")
        if inserted % 50000 == 0 and inserted > 0:
            elapsed = time.time() - t0
            rate = inserted / elapsed
            print(f"  {inserted:,} / {len(rows):,} ({rate:.0f} rows/s)")

    elapsed = time.time() - t0
    print(f"  DONE: {inserted:,} inserted, {errors} errors in {elapsed:.1f}s")


def main():
    parser = argparse.ArgumentParser(description="Bulk-load spine tables to Supabase")
    parser.add_argument("--table", choices=["transactions", "epc", "unmatched", "leases", "all"], default="all")
    args = parser.parse_args()

    sb = get_supabase()

    # DuckDB connection (shared for transactions, epc, unmatched)
    con = None
    if args.table in ("transactions", "epc", "unmatched", "all"):
        if not DUCKDB_PATH.exists():
            print(f"ERROR: DuckDB not found at {DUCKDB_PATH}")
            sys.exit(1)
        con = duckdb.connect(str(DUCKDB_PATH), read_only=True)

    print(f"Spine version: {SPINE_VERSION}")
    print(f"Batch size: {BATCH_SIZE}")
    print()

    if args.table in ("transactions", "all"):
        load_transactions(sb, con)
        print()

    if args.table in ("epc", "all"):
        load_epc_certificates(sb, con)
        print()

    if args.table in ("unmatched", "all"):
        load_unmatched(sb, con)
        print()

    if args.table in ("leases", "all"):
        load_leases(sb)
        print()

    if con:
        con.close()

    print("=== SPINE LOAD COMPLETE ===")


if __name__ == "__main__":
    main()
