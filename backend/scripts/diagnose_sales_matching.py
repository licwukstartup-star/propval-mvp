#!/usr/bin/env python3
"""
Sales Matching Diagnostic Engine
=================================
Proactively finds address-matching bugs by testing the parser + filter
against real Land Registry PPD data where the correct answer is known.

For each unique property in the PPD cache, it:
  1. Reconstructs a "user-style" address from LR structured fields
  2. Runs it through parse_user_address_parts → _filter_sales
  3. Checks if the known sale was found
  4. Reports misses — each one is a matching bug to fix

Usage:
    python scripts/diagnose_sales_matching.py E16          # test one outward code
    python scripts/diagnose_sales_matching.py E16 SW1A W2  # test multiple
    python scripts/diagnose_sales_matching.py --all        # test all cached codes

Output:
    Console summary + CSV report of all misses at scripts/sales_match_misses.csv
"""

import asyncio
import csv
import os
import sys
import time
from collections import defaultdict
from pathlib import Path

# Add backend to path and load .env
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

from routers.property import (
    parse_user_address_parts,
    _filter_sales,
    _normalise_street,
    is_saon,
    normalise_postcode,
)


def reconstruct_user_address(row: dict) -> str:
    """Build a realistic user-typed address from LR structured fields.

    Simulates how a user would type the address — no guaranteed commas,
    building name may be concatenated with street, etc.
    """
    saon = (row.get("saon") or "").strip()
    paon = (row.get("paon") or "").strip()
    street = (row.get("street") or "").strip()
    town = (row.get("town") or "").strip()
    postcode = (row.get("postcode") or "").strip()

    parts = []
    if saon:
        parts.append(saon)
    if paon:
        parts.append(paon)
    if street:
        parts.append(street)
    if town:
        parts.append(town)
    if postcode:
        parts.append(postcode)

    return " ".join(parts)


def reconstruct_with_commas(row: dict) -> str:
    """Build comma-separated address (the 'easy' variant)."""
    saon = (row.get("saon") or "").strip()
    paon = (row.get("paon") or "").strip()
    street = (row.get("street") or "").strip()
    town = (row.get("town") or "").strip()
    postcode = (row.get("postcode") or "").strip()

    parts = []
    if saon:
        parts.append(saon)
    if paon:
        parts.append(paon)
    if street:
        parts.append(street)
    if town:
        parts.append(town)
    if postcode:
        parts.append(postcode)

    return ", ".join(parts)


def classify_address(row: dict) -> str:
    """Classify the address pattern for reporting."""
    saon = (row.get("saon") or "").strip()
    paon = (row.get("paon") or "").strip()
    import re

    if saon and re.match(r"^(FLAT|APARTMENT|APT|UNIT)\s+", saon, re.IGNORECASE):
        if paon and not re.match(r"^\d", paon):
            return "flat_in_named_building"  # FLAT 5, BRIARY COURT
        elif paon and re.match(r"^\d", paon):
            return "flat_at_number"  # FLAT 3, 12 HIGH STREET
        else:
            return "flat_no_paon"
    elif saon and re.match(r"^\d+\w*$", saon):
        if paon and not re.match(r"^\d", paon):
            return "number_in_named_building"  # 5, BRIARY COURT (saon=5, paon=building)
        else:
            return "number_saon"
    elif saon:
        return "named_saon"  # THE LODGE, etc.
    elif paon and not re.match(r"^\d", paon):
        return "named_building_no_saon"  # COMPASS HOUSE (no flat number)
    elif paon and re.match(r"^\d+\w*\s*-\s*\d+\w*$", paon):
        return "range_paon"  # 5-7 PARK ROAD
    elif paon and re.match(r"^\d", paon):
        return "house_number"  # 41 HIGH STREET
    else:
        return "other"


def test_address_matching(all_rows: list[dict], postcode: str) -> dict:
    """Test all unique addresses in a postcode against the matching engine.

    Returns a dict with test results.
    """
    # Group rows by unique (saon, paon, street) to get unique properties
    properties: dict[tuple, list[dict]] = defaultdict(list)
    for row in all_rows:
        if row.get("postcode", "").upper() != postcode.upper():
            continue
        key = (
            (row.get("saon") or "").strip().upper(),
            (row.get("paon") or "").strip().upper(),
            (row.get("street") or "").strip().upper(),
        )
        properties[key].append(row)

    results = {
        "postcode": postcode,
        "total_properties": len(properties),
        "hits": 0,
        "misses": [],
        "miss_details": [],
    }

    for (saon, paon, street), rows in properties.items():
        expected_count = len(rows)
        sample_row = rows[0]
        pattern = classify_address(sample_row)

        # Test 1: no-comma address (hardest — how users often type)
        addr_no_comma = reconstruct_user_address(sample_row)
        parts_nc = parse_user_address_parts(addr_no_comma, postcode)
        found_nc = _filter_sales(all_rows, parts_nc)

        # Test 2: comma-separated address (easier)
        addr_comma = reconstruct_with_commas(sample_row)
        parts_c = parse_user_address_parts(addr_comma, postcode)
        found_c = _filter_sales(all_rows, parts_c)

        # A hit if EITHER variant finds at least one sale for this property
        hit_nc = any(
            f["date"] == r.get("deed_date", "")[:10] and f["price"] == int(r.get("price_paid") or 0)
            for f in found_nc
            for r in rows
        )
        hit_c = any(
            f["date"] == r.get("deed_date", "")[:10] and f["price"] == int(r.get("price_paid") or 0)
            for f in found_c
            for r in rows
        )

        if hit_nc or hit_c:
            results["hits"] += 1
        else:
            results["misses"].append({
                "saon": saon,
                "paon": paon,
                "street": street,
                "postcode": postcode,
                "pattern": pattern,
                "expected_sales": expected_count,
                "found_no_comma": len(found_nc),
                "found_comma": len(found_c),
                "addr_no_comma": addr_no_comma,
                "addr_comma": addr_comma,
                "parsed_nc": parts_nc,
                "parsed_c": parts_c,
            })

        # Also track partial failures (comma works but no-comma doesn't)
        if hit_c and not hit_nc:
            results["miss_details"].append({
                "saon": saon,
                "paon": paon,
                "street": street,
                "postcode": postcode,
                "pattern": pattern,
                "issue": "no_comma_fail",
                "addr_no_comma": addr_no_comma,
                "parsed_nc": parts_nc,
            })

    return results


def _retry(fn, max_retries=3, delay=5):
    """Retry a callable on connection errors."""
    import httpx
    for attempt in range(max_retries):
        try:
            return fn()
        except (httpx.RemoteProtocolError, httpx.ConnectError, Exception) as e:
            if attempt == max_retries - 1:
                raise
            err_name = type(e).__name__
            if "Protocol" in err_name or "Connect" in err_name or "Terminated" in str(e):
                print(f"\n  [retry {attempt+1}/{max_retries}] {err_name}, waiting {delay}s...")
                time.sleep(delay)
                # Force new Supabase client
                import routers.ppd_cache as ppc
                ppc._sb_client = None
            else:
                raise


async def get_cached_outward_codes() -> list[str]:
    """Get all outward codes currently in the PPD cache."""
    from routers.ppd_cache import _get_sb

    def _do():
        sb = _get_sb()
        return sb.table("ppd_cache_status").select("outward_code").execute()
    resp = _retry(_do)
    return [r["outward_code"] for r in (resp.data or [])]


async def fetch_postcode_rows(postcode: str) -> list[dict]:
    """Fetch all PPD rows for a single postcode from cache."""
    from routers.ppd_cache import query_by_postcode_all_time

    async def _do():
        return await query_by_postcode_all_time(postcode)

    import httpx
    for attempt in range(3):
        try:
            return await _do()
        except (httpx.RemoteProtocolError, httpx.ConnectError) as e:
            if attempt == 2:
                raise
            print(f"\n  [retry {attempt+1}/3] {type(e).__name__}, waiting 5s...")
            await asyncio.sleep(5)
            import routers.ppd_cache as ppc
            ppc._sb_client = None
    return []


async def get_postcodes_for_outward(outward_code: str) -> list[str]:
    """Get all unique postcodes cached for an outward code."""
    from routers.ppd_cache import ensure_cache, _get_sb

    await ensure_cache(outward_code)

    all_pcs: set[str] = set()
    page_size = 1000
    offset = 0
    while True:
        def _do(off=offset):
            sb = _get_sb()
            return (
                sb.table("price_paid_cache")
                .select("postcode")
                .eq("outward_code", outward_code)
                .range(off, off + page_size - 1)
                .execute()
            )
        resp = _retry(_do)
        rows = resp.data or []
        for r in rows:
            if r.get("postcode"):
                all_pcs.add(r["postcode"])
        if len(rows) < page_size:
            break
        offset += page_size

    return sorted(all_pcs)


async def run_diagnosis(outward_codes: list[str]):
    """Run the full diagnostic across the given outward codes."""
    print("=" * 70)
    print("  SALES MATCHING DIAGNOSTIC ENGINE")
    print("=" * 70)
    print()

    all_misses = []
    all_partial = []
    total_props = 0
    total_hits = 0
    total_misses = 0
    pattern_stats: dict[str, dict] = defaultdict(lambda: {"total": 0, "hits": 0, "misses": 0})

    for code in outward_codes:
        print(f"Testing {code}...", end=" ", flush=True)
        t0 = time.monotonic()

        postcodes = await get_postcodes_for_outward(code)
        if not postcodes:
            print(f"no data (cache empty)")
            continue

        code_props = 0
        code_hits = 0
        code_misses = 0

        for pc in postcodes:
            pc_rows = await fetch_postcode_rows(pc)
            if not pc_rows:
                continue
            result = test_address_matching(pc_rows, pc)

            code_props += result["total_properties"]
            code_hits += result["hits"]
            code_misses += len(result["misses"])

            for m in result["misses"]:
                pattern_stats[m["pattern"]]["total"] += 1
                pattern_stats[m["pattern"]]["misses"] += 1
                all_misses.append(m)

            for m in result["miss_details"]:
                all_partial.append(m)

            # Count hits by pattern
            for (saon, paon, street), prop_rows in defaultdict(list, {
                ((r.get("saon") or "").strip().upper(),
                 (r.get("paon") or "").strip().upper(),
                 (r.get("street") or "").strip().upper()): r
                for r in pc_rows
            }).items():
                pat = classify_address({"saon": saon, "paon": paon, "street": street})
                pattern_stats[pat]["total"] += 1
                if not any(
                    m["saon"] == saon and m["paon"] == paon and m["street"] == street
                    for m in result["misses"]
                ):
                    pattern_stats[pat]["hits"] += 1

        elapsed = time.monotonic() - t0
        miss_rate = (code_misses / code_props * 100) if code_props > 0 else 0
        print(f"{code_props} properties, {code_hits} hits, {code_misses} misses ({miss_rate:.1f}%) [{elapsed:.1f}s]")

        total_props += code_props
        total_hits += code_hits
        total_misses += code_misses

    # Summary
    print()
    print("=" * 70)
    print("  SUMMARY")
    print("=" * 70)
    print(f"  Total properties tested:  {total_props:,}")
    print(f"  Hits:                     {total_hits:,}")
    print(f"  Total misses:             {total_misses:,}")
    miss_rate = (total_misses / total_props * 100) if total_props > 0 else 0
    print(f"  Match rate:               {100 - miss_rate:.1f}%")
    print(f"  Partial (comma-only):     {len(all_partial):,}")
    print()

    if pattern_stats:
        print("  BY PATTERN:")
        print(f"  {'Pattern':<30} {'Total':>7} {'Miss':>7} {'Rate':>7}")
        print(f"  {'-'*30} {'-'*7} {'-'*7} {'-'*7}")
        for pat, s in sorted(pattern_stats.items(), key=lambda x: x[1]["misses"], reverse=True):
            rate = (s["misses"] / s["total"] * 100) if s["total"] > 0 else 0
            print(f"  {pat:<30} {s['total']:>7,} {s['misses']:>7,} {rate:>6.1f}%")

    # Write CSV report
    if all_misses:
        csv_path = Path(__file__).parent / "sales_match_misses.csv"
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=[
                "postcode", "saon", "paon", "street", "pattern",
                "expected_sales", "found_no_comma", "found_comma",
                "addr_no_comma", "addr_comma", "parsed_nc", "parsed_c",
            ])
            writer.writeheader()
            for m in all_misses:
                writer.writerow({
                    **m,
                    "parsed_nc": str(m["parsed_nc"]),
                    "parsed_c": str(m["parsed_c"]),
                })
        print(f"\n  Misses written to: {csv_path}")

    if all_partial:
        csv_path = Path(__file__).parent / "sales_match_partial.csv"
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=[
                "postcode", "saon", "paon", "street", "pattern",
                "issue", "addr_no_comma", "parsed_nc",
            ])
            writer.writeheader()
            for m in all_partial:
                writer.writerow({**m, "parsed_nc": str(m["parsed_nc"])})
        print(f"  Partial fails written to: {csv_path}")

    print()
    return total_misses


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Sales matching diagnostic engine")
    parser.add_argument("codes", nargs="*", help="Outward codes to test (e.g. E16 SW1A W2)")
    parser.add_argument("--all", action="store_true", help="Test all cached outward codes")
    parser.add_argument("--borough", type=str, help="Test a London borough (e.g. 'Newham', 'Wandsworth')")
    parser.add_argument("--tier", type=str, choices=["1", "2", "3", "3a", "3b", "3c"], help="Test all boroughs in a priority tier (3a/3b/3c for Tier 3 batches)")
    parser.add_argument("--london", action="store_true", help="Test ALL London outward codes")
    parser.add_argument("--plan", action="store_true", help="Show borough plan with estimates (no testing)")
    args = parser.parse_args()

    from london_borough_codes import (BOROUGH_CODES, ALL_LONDON_CODES,
        TIER_1_PRIORITY, TIER_2_PRIORITY, TIER_3_PRIORITY,
        TIER_3A_PRIORITY, TIER_3B_PRIORITY, TIER_3C_PRIORITY)

    if args.plan:
        # E16 benchmark: 15,545 properties in 92s across ~100 postcodes
        # ~0.9s per postcode (dominated by Supabase round-trips)
        print("=" * 70)
        print("  LONDON BOROUGH DIAGNOSTIC PLAN")
        print("=" * 70)
        print()
        print(f"  {'Borough':<30} {'Codes':>5}  {'Est. time':>10}")
        print(f"  {'-'*30} {'-'*5}  {'-'*10}")

        for tier_name, tier_boroughs in [
            ("TIER 1 — High volume residential", TIER_1_PRIORITY),
            ("TIER 2 — Prime / high value", TIER_2_PRIORITY),
            ("TIER 3 — Outer London", TIER_3_PRIORITY),
        ]:
            print(f"\n  {tier_name}")
            tier_total_codes = 0
            for borough in tier_boroughs:
                codes = BOROUGH_CODES.get(borough, [])
                # Estimate: ~1.5 min per outward code on average
                est_min = len(codes) * 1.5
                tier_total_codes += len(codes)
                print(f"  {borough:<30} {len(codes):>5}  {est_min:>7.0f} min")
            tier_est = tier_total_codes * 1.5
            print(f"  {'TIER TOTAL':<30} {tier_total_codes:>5}  {tier_est:>7.0f} min ({tier_est/60:.1f} hrs)")

        total_codes = len(ALL_LONDON_CODES)
        total_est = total_codes * 1.5
        print(f"\n  {'ALL LONDON':<30} {total_codes:>5}  {total_est:>7.0f} min ({total_est/60:.1f} hrs)")
        print()
        print("  Usage:")
        print("    python scripts/diagnose_sales_matching.py --borough Newham")
        print("    python scripts/diagnose_sales_matching.py --tier 1")
        print("    python scripts/diagnose_sales_matching.py --london")
        print()
        return

    async def _run():
        if args.london:
            codes = ALL_LONDON_CODES
            print(f"Testing ALL London: {len(codes)} outward codes\n")
        elif args.tier:
            tier_map = {
                "1": TIER_1_PRIORITY, "2": TIER_2_PRIORITY, "3": TIER_3_PRIORITY,
                "3a": TIER_3A_PRIORITY, "3b": TIER_3B_PRIORITY, "3c": TIER_3C_PRIORITY,
            }
            boroughs = tier_map[args.tier]
            codes = sorted(set(c for b in boroughs for c in BOROUGH_CODES.get(b, [])))
            print(f"Testing Tier {args.tier.upper()} ({len(boroughs)} boroughs): {len(codes)} outward codes\n")
            print(f"  Boroughs: {', '.join(boroughs)}\n")
        elif args.borough:
            borough_name = args.borough.strip()
            # Case-insensitive lookup
            match = None
            for b in BOROUGH_CODES:
                if b.lower() == borough_name.lower():
                    match = b
                    break
            if not match:
                # Fuzzy: check if input is a substring
                matches = [b for b in BOROUGH_CODES if borough_name.lower() in b.lower()]
                if len(matches) == 1:
                    match = matches[0]
                elif matches:
                    print(f"Ambiguous borough name. Did you mean: {', '.join(matches)}?")
                    return
                else:
                    print(f"Borough '{borough_name}' not found. Available boroughs:")
                    for b in sorted(BOROUGH_CODES.keys()):
                        print(f"  {b}")
                    return
            codes = BOROUGH_CODES[match]
            print(f"Testing {match}: {len(codes)} outward codes ({', '.join(codes)})\n")
        elif args.all:
            codes = await get_cached_outward_codes()
            if not codes:
                print("No cached outward codes found. Run some property searches first.")
                return
            print(f"Testing all {len(codes)} cached outward codes...\n")
        elif args.codes:
            codes = [c.upper() for c in args.codes]
        else:
            parser.print_help()
            return

        misses = await run_diagnosis(codes)
        sys.exit(1 if misses > 0 else 0)

    asyncio.run(_run())


if __name__ == "__main__":
    main()
