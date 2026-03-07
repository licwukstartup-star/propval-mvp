#!/usr/bin/env python3
"""
Import HMLR Registered Leases CSV into Supabase registered_leases table.

Usage (from project root):
    py -3.11 scripts/import_leases.py LEASES_FULL_2026_02.csv

Run the table creation SQL in Supabase SQL Editor first:
    CREATE TABLE IF NOT EXISTS registered_leases (
        uprn TEXT PRIMARY KEY,
        date_of_lease DATE,
        term_years INTEGER,
        expiry_date DATE
    );
"""

import csv
import os
import re
import sys
from datetime import date
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    sys.exit("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env")

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

BATCH_SIZE = 2000

# ---------------------------------------------------------------------------
# Term text parser
# Handles:
#   "125 years from 1 January 2000"
#   "999 years (less one day) from 10 March 1900"
#   "999 years from and including 1 January 2014"
# ---------------------------------------------------------------------------

MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5,
    "june": 6, "july": 7, "august": 8, "september": 9, "october": 10,
    "november": 11, "december": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6, "jul": 7,
    "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

TERM_RE = re.compile(
    r"(\d+)\s+years?.*?from\s+(?:and\s+including\s+)?(\d{1,2})\s+(\w+)\s+(\d{4})",
    re.IGNORECASE,
)


def parse_term(term_text: str):
    """Return (commencement: date, term_years: int, expiry: date) or (None, None, None)."""
    m = TERM_RE.search(term_text)
    if not m:
        return None, None, None
    term_years = int(m.group(1))
    day        = int(m.group(2))
    month      = MONTHS.get(m.group(3).lower())
    year       = int(m.group(4))
    if not month:
        return None, None, None
    try:
        commencement = date(year, month, day)
        expiry_year  = min(year + term_years, 9999)  # cap at max date
        expiry       = date(expiry_year, month, day)
        return commencement, term_years, expiry
    except ValueError:
        return None, None, None


# ---------------------------------------------------------------------------
# Main import loop
# ---------------------------------------------------------------------------

def run(csv_path: str) -> None:
    path = Path(csv_path)
    if not path.exists():
        sys.exit(f"ERROR: File not found: {csv_path}")

    print(f"Source : {path}")
    print(f"Batch  : {BATCH_SIZE} rows per upsert")
    print()

    batch: list[dict] = []
    total = inserted = skipped_no_uprn = skipped_no_term = 0

    with open(path, encoding="utf-8-sig", errors="replace", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            total += 1

            if total % 500_000 == 0:
                pct = total / 7_721_945 * 100
                print(f"  {total:>7,} rows ({pct:.0f}%) — inserted {inserted:,} | "
                      f"no-uprn {skipped_no_uprn:,} | no-term {skipped_no_term:,}")

            # --- UPRN ---
            uprn = row.get("OS UPRN", "").strip()
            if not uprn:
                skipped_no_uprn += 1
                continue

            # --- Term ---
            term_text = row.get("Term", "").strip()
            commencement, term_years, expiry = parse_term(term_text)
            if commencement is None:
                skipped_no_term += 1
                continue

            batch.append({
                "uprn":          uprn,
                "date_of_lease": commencement.isoformat(),
                "term_years":    term_years,
                "expiry_date":   expiry.isoformat(),
            })

            if len(batch) >= BATCH_SIZE:
                _flush(batch)
                inserted += len(batch)
                batch = []

    if batch:
        _flush(batch)
        inserted += len(batch)

    print()
    print("=" * 50)
    print(f"Done.")
    print(f"  Total rows read : {total:,}")
    print(f"  Inserted        : {inserted:,}")
    print(f"  Skipped (no UPRN)  : {skipped_no_uprn:,}")
    print(f"  Skipped (no term)  : {skipped_no_term:,}")


def _flush(batch: list[dict]) -> None:
    sb.table("registered_leases").upsert(batch, on_conflict="uprn").execute()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(f"Usage: py -3.11 {sys.argv[0]} <path-to-leases-csv>")
    run(sys.argv[1])
