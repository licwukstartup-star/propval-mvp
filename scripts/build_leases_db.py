#!/usr/bin/env python3
"""
Convert the HMLR Registered Leases CSV into a local SQLite database.

Usage (from project root):
    py -3.11 scripts/build_leases_db.py LEASES_FULL_2026_02.csv

Output: backend/data/leases.db  (~300 MB, git-ignored)

The backend queries this file directly — no Supabase required.
"""

import csv
import re
import sqlite3
import sys
from datetime import date
from pathlib import Path

# ---------------------------------------------------------------------------
# Term parser
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
        expiry       = date(min(year + term_years, 9999), month, day)
        return commencement.isoformat(), term_years, expiry.isoformat()
    except ValueError:
        return None, None, None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run(csv_path: str) -> None:
    src = Path(csv_path)
    if not src.exists():
        sys.exit(f"ERROR: File not found: {csv_path}")

    db_path = Path(__file__).resolve().parent.parent / "backend" / "data" / "leases.db"
    print(f"Source : {src}")
    print(f"Output : {db_path}")
    print()

    con = sqlite3.connect(db_path)
    cur = con.cursor()

    cur.executescript("""
        DROP TABLE IF EXISTS registered_leases;
        CREATE TABLE registered_leases (
            uprn          TEXT PRIMARY KEY,
            date_of_lease TEXT,
            term_years    INTEGER,
            expiry_date   TEXT
        );
    """)
    con.commit()

    batch: list[tuple] = []
    BATCH_SIZE = 5000
    total = inserted = skipped = 0

    with open(src, encoding="utf-8-sig", errors="replace", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            total += 1
            if total % 500_000 == 0:
                pct = total / 7_721_945 * 100
                print(f"  {total:>7,} rows ({pct:.0f}%) — inserted {inserted:,}")

            if not row:
                skipped += 1
                continue

            uprn = (row.get("OS UPRN") or "").strip()
            if not uprn:
                skipped += 1
                continue

            commencement, term_years, expiry = parse_term(row.get("Term") or "")
            if commencement is None:
                skipped += 1
                continue

            batch.append((uprn, commencement, term_years, expiry))

            if len(batch) >= BATCH_SIZE:
                cur.executemany(
                    "INSERT OR REPLACE INTO registered_leases VALUES (?,?,?,?)",
                    batch,
                )
                con.commit()
                inserted += len(batch)
                batch = []

    if batch:
        cur.executemany(
            "INSERT OR REPLACE INTO registered_leases VALUES (?,?,?,?)",
            batch,
        )
        con.commit()
        inserted += len(batch)

    print()
    print("Creating index...")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_uprn ON registered_leases(uprn)")
    con.commit()
    con.close()

    size_mb = db_path.stat().st_size / 1024 / 1024
    print()
    print("=" * 50)
    print(f"Done.")
    print(f"  Total rows read : {total:,}")
    print(f"  Inserted        : {inserted:,}")
    print(f"  Skipped         : {skipped:,}")
    print(f"  DB size         : {size_mb:.0f} MB  →  {db_path}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(f"Usage: py -3.11 {sys.argv[0]} <path-to-leases-csv>")
    run(sys.argv[1])
