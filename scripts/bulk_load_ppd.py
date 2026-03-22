"""
Bulk-load London PPD data from pp-complete.csv into Supabase price_paid_cache.

Source: Research/EPC PPD merge project/raw/pp-complete.csv (all UK, 1995-2026)
Target: Supabase price_paid_cache

Filters to London postcodes only. Skips outward codes already cached.

Usage:
    cd propval-mvp
    python scripts/bulk_load_ppd.py
"""

import csv
import os
import sys
import time
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

CSV_PATH = Path(__file__).resolve().parent.parent / "Research" / "EPC PPD merge project" / "raw" / "pp-complete.csv"
BATCH_SIZE = 500

# London outward code prefixes (covers all 33 boroughs)
LONDON_PREFIXES = (
    "E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "E9",
    "E10", "E11", "E12", "E13", "E14", "E15", "E16", "E17", "E18",
    "EC1", "EC2", "EC3", "EC4",
    "N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8", "N9",
    "N10", "N11", "N12", "N13", "N14", "N15", "N16", "N17", "N18", "N19", "N20", "N21", "N22",
    "NW1", "NW2", "NW3", "NW4", "NW5", "NW6", "NW7", "NW8", "NW9", "NW10", "NW11",
    "SE1", "SE2", "SE3", "SE4", "SE5", "SE6", "SE7", "SE8", "SE9",
    "SE10", "SE11", "SE12", "SE13", "SE14", "SE15", "SE16", "SE17", "SE18", "SE19",
    "SE20", "SE21", "SE22", "SE23", "SE24", "SE25", "SE26", "SE27", "SE28",
    "SW1", "SW2", "SW3", "SW4", "SW5", "SW6", "SW7", "SW8", "SW9",
    "SW10", "SW11", "SW12", "SW13", "SW14", "SW15", "SW16", "SW17", "SW18", "SW19", "SW20",
    "W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8", "W9",
    "W10", "W11", "W12", "W13", "W14",
    "WC1", "WC2",
    # Outer London codes that cross borough boundaries
    "BR", "CR", "DA", "EN", "HA", "IG", "KT", "RM", "SM", "TW", "UB",
)

# PPD CSV columns (no header in pp-complete.csv)
PPD_COLS = [
    "unique_id", "price_paid", "deed_date", "postcode", "property_type",
    "new_build", "estate_type", "saon", "paon", "street", "locality",
    "town", "district", "county", "ppd_category", "record_status",
]


def _outward(postcode: str) -> str:
    """Extract outward code from a full postcode."""
    parts = postcode.strip().split()
    return parts[0].upper() if parts else ""


def _is_london(outward: str) -> bool:
    """Check if an outward code is in Greater London."""
    return any(outward == p or outward.startswith(p) for p in LONDON_PREFIXES)


def main():
    if not CSV_PATH.exists():
        print(f"ERROR: CSV not found at {CSV_PATH}")
        sys.exit(1)

    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    # Get already-cached outward codes
    resp = sb.table("ppd_cache_status").select("outward_code").execute()
    cached = set(r["outward_code"] for r in resp.data)
    print(f"Already cached: {len(cached)} outward codes")

    # Read CSV and filter to London, skip already-cached codes
    print(f"Reading {CSV_PATH.name}...")
    t0 = time.time()
    rows_by_oc: dict[str, list[dict]] = {}
    total_read = 0
    london_rows = 0

    with open(CSV_PATH, "r", encoding="utf-8", errors="replace") as f:
        reader = csv.reader(f)
        for row in reader:
            total_read += 1
            if len(row) < 16:
                continue
            data = dict(zip(PPD_COLS, row))

            # Strip curly braces from unique_id
            uid = data["unique_id"].strip().strip("{}")
            if not uid:
                continue

            pc = data["postcode"].strip().upper()
            outward = _outward(pc)
            if not outward or not _is_london(outward):
                continue
            if outward in cached:
                continue

            london_rows += 1
            price = 0
            try:
                price = int(data["price_paid"])
            except (ValueError, TypeError):
                continue
            if price <= 0:
                continue

            if outward not in rows_by_oc:
                rows_by_oc[outward] = []
            rows_by_oc[outward].append({
                "transaction_id": uid,
                "outward_code": outward,
                "postcode": pc,
                "deed_date": data["deed_date"].strip(),
                "price_paid": price,
                "property_type": data["property_type"].strip().upper(),
                "new_build": data["new_build"].strip().upper(),
                "estate_type": data["estate_type"].strip().upper(),
                "saon": data["saon"].strip().upper(),
                "paon": data["paon"].strip().upper(),
                "street": data["street"].strip().upper(),
                "locality": data["locality"].strip().upper(),
                "town": data["town"].strip().upper(),
                "district": data["district"].strip().upper(),
                "county": data["county"].strip().upper(),
                "transaction_category": data["ppd_category"].strip().upper(),
                "uprn": None,
            })

            if total_read % 5_000_000 == 0:
                print(f"  ...{total_read:,} rows scanned, {london_rows:,} London (uncached)")

    print(f"  Scanned {total_read:,} rows in {time.time() - t0:.1f}s")
    print(f"  {london_rows:,} London rows across {len(rows_by_oc)} new outward codes")

    # Upload per outward code
    total_uploaded = 0
    total_errors = 0
    t0 = time.time()
    oc_list = sorted(rows_by_oc.keys())

    for idx, oc in enumerate(oc_list):
        oc_rows = rows_by_oc[oc]
        oc_uploaded = 0

        for i in range(0, len(oc_rows), BATCH_SIZE):
            batch = oc_rows[i:i + BATCH_SIZE]
            try:
                sb.table("price_paid_cache") \
                    .upsert(batch, on_conflict="transaction_id") \
                    .execute()
                oc_uploaded += len(batch)
            except Exception as e:
                total_errors += 1
                if total_errors <= 5:
                    print(f"  ERROR ({oc}): {e}")

        total_uploaded += oc_uploaded

        # Update cache status
        try:
            sb.table("ppd_cache_status").upsert({
                "outward_code": oc,
                "last_fetched": datetime.utcnow().isoformat(),
                "row_count": len(oc_rows),
            }, on_conflict="outward_code").execute()
        except Exception:
            pass

        elapsed = time.time() - t0
        rate = total_uploaded / elapsed if elapsed > 0 else 0
        print(f"  [{idx + 1}/{len(oc_list)}] {oc}: {len(oc_rows):,} rows | Total: {total_uploaded:,}, {rate:.0f} rows/s")

    elapsed = time.time() - t0
    print(f"\nDone. {total_uploaded:,} rows uploaded in {elapsed:.1f}s ({total_errors} errors)")

    resp = sb.table("ppd_cache_status").select("outward_code", count="exact").execute()
    print(f"Total cached outward codes: {resp.count}")


if __name__ == "__main__":
    main()
