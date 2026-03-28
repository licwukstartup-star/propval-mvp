"""Phase 1: Join matched + epc in local DuckDB. Zero Supabase CPU."""
import csv
import time
from pathlib import Path

import duckdb

DUCKDB_PATH = Path(__file__).resolve().parent.parent / "Research" / "EPC PPD merge project" / "db" / "propval.duckdb"
OUTPUT = Path(__file__).resolve().parent / "epc_backfill_data" / "joined_backfill.csv"

con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
print("DuckDB connected. Running join...")
t0 = time.time()

rows = con.execute("""
    SELECT
        m.transaction_id,
        COALESCE(e.BUILT_FORM, 'Unknown') AS epc_built_form,
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

print(f"  Join complete: {len(rows):,} rows in {time.time()-t0:.1f}s")

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
with open(OUTPUT, "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerow(["transaction_id", "epc_built_form", "habitable_rooms", "energy_score"])
    for row in rows:
        writer.writerow(row)

print(f"  CSV written: {OUTPUT}")
