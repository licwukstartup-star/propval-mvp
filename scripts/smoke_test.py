"""
Layer 4: E2E Smoke Test — verifies the critical user path works.

Tests against a running backend (localhost:8000 by default).
Uses real Supabase data. Throttled: 1s delay between calls.

Usage:
    cd propval-mvp
    python scripts/smoke_test.py [--base-url http://localhost:8000]
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Use a known good Sutton postcode (always in spine)
TEST_POSTCODE = "SM1 2EG"
DELAY = 1.0  # seconds between API calls


def _get_auth_token():
    """Get a valid JWT by signing in with Supabase Auth."""
    from supabase import create_client
    url = os.environ["SUPABASE_URL"]
    key = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_ANON_KEY", "")
    if not key:
        # Fall back to service role for testing
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    sb = create_client(url, key)
    # Try to get existing session or sign in
    email = os.environ.get("TEST_EMAIL", "licwukstartup@gmail.com")
    password = os.environ.get("TEST_PASSWORD", "")
    if not password:
        print("  SKIP: No TEST_PASSWORD in .env — cannot authenticate")
        return None
    try:
        resp = sb.auth.sign_in_with_password({"email": email, "password": password})
        return resp.session.access_token
    except Exception as e:
        print(f"  SKIP: Auth failed — {e}")
        return None


def main():
    parser = argparse.ArgumentParser(description="PropVal E2E Smoke Test")
    parser.add_argument("--base-url", default="http://localhost:8000", help="Backend base URL")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    print("=" * 60)
    print("PropVal E2E Smoke Test")
    print(f"Target: {base}")
    print(f"Test postcode: {TEST_POSTCODE}")
    print("=" * 60)
    print()

    token = _get_auth_token()
    if not token:
        print("Cannot proceed without auth token. Set TEST_PASSWORD in .env")
        sys.exit(1)

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    client = httpx.Client(timeout=30.0)
    results = []

    def _step(name, method, url, **kwargs):
        print(f"  [{len(results)+1}] {name}...", end=" ", flush=True)
        t0 = time.time()
        try:
            if method == "GET":
                resp = client.get(url, headers=headers, **kwargs)
            else:
                resp = client.post(url, headers=headers, **kwargs)
            elapsed = time.time() - t0
            if resp.status_code < 400:
                data = resp.json()
                results.append(("PASS", name, elapsed, data))
                print(f"PASS ({elapsed:.1f}s)")
                return data
            else:
                results.append(("FAIL", name, elapsed, resp.text[:200]))
                print(f"FAIL {resp.status_code} ({elapsed:.1f}s)")
                return None
        except Exception as e:
            elapsed = time.time() - t0
            results.append(("FAIL", name, elapsed, str(e)[:200]))
            print(f"ERROR ({elapsed:.1f}s) {e}")
            return None
        finally:
            time.sleep(DELAY)

    # Step 1: Autocomplete
    auto = _step(
        "Autocomplete",
        "GET",
        f"{base}/api/property/autocomplete?postcode={TEST_POSTCODE.replace(' ', '%20')}",
    )
    if not auto or not auto.get("addresses"):
        print("\n  FATAL: Autocomplete returned no addresses. Aborting.")
        _print_summary(results)
        sys.exit(1)

    first_address = auto["addresses"][0]["address"]
    print(f"         → {first_address}")

    # Step 2: Property Search
    search = _step(
        "Property Search",
        "POST",
        f"{base}/api/property/search",
        json={"address": first_address},
    )
    if not search:
        print("\n  FATAL: Property search failed. Aborting.")
        _print_summary(results)
        sys.exit(1)

    uprn = search.get("uprn", "unknown")
    sales_count = len(search.get("sales", []))
    print(f"         → UPRN: {uprn}, {sales_count} sales")

    # Step 3: Comparable Search
    comp_subject = {
        "postcode": search.get("postcode", TEST_POSTCODE),
        "property_type": search.get("property_type", "House"),
        "built_form": search.get("built_form"),
        "tenure": "leasehold" if search.get("lease_commencement") else "freehold",
        "bedrooms": search.get("habitable_rooms", 3),
        "floor_area_sqm": search.get("floor_area_sqm"),
        "building_name": None,
        "street_name": None,
        "paon_number": None,
        "construction_age_band": search.get("construction_age_band"),
    }
    comps = _step(
        "Comparable Search",
        "POST",
        f"{base}/api/comparables/search",
        json={"subject": comp_subject, "target_count": 5, "time_window_months": 36},
    )
    comp_count = len(comps.get("comparables", [])) if comps else 0
    print(f"         → {comp_count} comparables found")

    # Step 4: Create Case
    case = _step(
        "Create Case",
        "POST",
        f"{base}/api/cases",
        json={
            "address": first_address,
            "postcode": search.get("postcode", TEST_POSTCODE),
            "uprn": uprn,
            "case_type": "research",
            "property_data": search,
        },
    )
    case_id = case.get("id") if case else None
    print(f"         → Case ID: {case_id}")

    # Step 5: Retrieve Case
    if case_id:
        retrieved = _step(
            "Retrieve Case",
            "GET",
            f"{base}/api/cases/{case_id}",
        )
        if retrieved:
            print(f"         → Status: {retrieved.get('status')}")

    # Summary
    print()
    _print_summary(results)

    # Clean up: delete the test case
    if case_id:
        try:
            client.delete(f"{base}/api/cases/{case_id}", headers=headers)
            print(f"\n  Cleaned up test case {case_id}")
        except Exception:
            pass

    client.close()

    # Exit code
    failed = sum(1 for r in results if r[0] == "FAIL")
    sys.exit(1 if failed > 0 else 0)


def _print_summary(results):
    print("=" * 60)
    passed = sum(1 for r in results if r[0] == "PASS")
    failed = sum(1 for r in results if r[0] == "FAIL")
    total_time = sum(r[2] for r in results)
    print(f"Results: {passed}/{len(results)} passed, {failed} failed")
    print(f"Total time: {total_time:.1f}s")
    if failed:
        print("\nFailures:")
        for status, name, elapsed, detail in results:
            if status == "FAIL":
                print(f"  ✗ {name}: {detail}")
    print("=" * 60)


if __name__ == "__main__":
    main()
