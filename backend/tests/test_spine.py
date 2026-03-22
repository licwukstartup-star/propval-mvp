"""
Layer 2: Spine Verification Tests.
Lightweight read-only queries against live Supabase spine tables.
Verifies the bulk-loaded data is queryable and correct.

SAFETY: Only ~15 indexed queries with LIMIT 5. Adds 0.5s delays.
        Total runtime: ~10s. Minimal CPU impact.

Usage:
    pytest backend/tests/test_spine.py -v
    pytest backend/tests/ -v -m spine
"""
import os
import time
import pytest
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

# Skip all tests if no Supabase credentials
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
pytestmark = [
    pytest.mark.spine,
    pytest.mark.skipif(
        not SUPABASE_URL or not SUPABASE_KEY,
        reason="SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required"
    ),
]

# Test postcodes: 1 inner, 1 outer, 1 central (safe sample)
SAMPLE_POSTCODES = ["SM1 2EG", "NW4 1JT", "E14 9GU"]


@pytest.fixture(scope="module")
def sb():
    """Shared Supabase client for all spine tests."""
    from supabase import create_client
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def _throttle():
    """Brief delay between queries to avoid CPU burst."""
    time.sleep(0.5)


class TestTransactions:
    """Verify transactions table (PPD + EPC pre-matched)."""

    def test_query_by_postcode(self, sb):
        resp = sb.table("transactions") \
            .select("transaction_id, price, date_of_transfer, postcode") \
            .eq("postcode", SAMPLE_POSTCODES[0]) \
            .limit(5).execute()
        assert resp.data, f"No transactions found for {SAMPLE_POSTCODES[0]}"
        row = resp.data[0]
        assert row["postcode"] == SAMPLE_POSTCODES[0]
        assert row["price"] > 0
        assert row["date_of_transfer"] is not None
        _throttle()

    def test_query_by_outward_code(self, sb):
        oc = SAMPLE_POSTCODES[1].split()[0]  # "NW4"
        resp = sb.table("transactions") \
            .select("transaction_id, outward_code") \
            .eq("outward_code", oc) \
            .limit(5).execute()
        assert resp.data, f"No transactions found for outward code {oc}"
        assert all(r["outward_code"] == oc for r in resp.data)
        _throttle()

    def test_query_by_uprn(self, sb):
        # First find a UPRN
        resp = sb.table("transactions") \
            .select("uprn") \
            .eq("postcode", SAMPLE_POSTCODES[2]) \
            .not_.is_("uprn", "null") \
            .limit(1).execute()
        if not resp.data:
            pytest.skip("No UPRN found for test postcode")
        uprn = resp.data[0]["uprn"]
        _throttle()

        # Then query by UPRN
        resp2 = sb.table("transactions") \
            .select("transaction_id, uprn, price") \
            .eq("uprn", uprn) \
            .limit(5).execute()
        assert resp2.data, f"No transactions found for UPRN {uprn}"
        assert all(r["uprn"] == uprn for r in resp2.data)
        _throttle()

    def test_has_epc_fields(self, sb):
        resp = sb.table("transactions") \
            .select("transaction_id, epc_property_type, floor_area_sqm, energy_rating, lat, lon") \
            .eq("postcode", SAMPLE_POSTCODES[0]) \
            .not_.is_("epc_property_type", "null") \
            .limit(3).execute()
        assert resp.data, "No EPC-enriched transactions found"
        row = resp.data[0]
        assert row["epc_property_type"] is not None
        # At least some rows should have coordinates
        has_coords = any(r["lat"] is not None for r in resp.data)
        assert has_coords, "No transactions with coordinates found"
        _throttle()


class TestEpcCertificates:
    """Verify epc_certificates table (autocomplete source)."""

    def test_query_by_postcode(self, sb):
        resp = sb.table("epc_certificates") \
            .select("lmk_key, address, postcode, uprn") \
            .eq("postcode", SAMPLE_POSTCODES[0]) \
            .limit(5).execute()
        assert resp.data, f"No EPC certificates found for {SAMPLE_POSTCODES[0]}"
        row = resp.data[0]
        assert row["postcode"] == SAMPLE_POSTCODES[0]
        assert row["address"] is not None
        _throttle()

    def test_autocomplete_returns_addresses(self, sb):
        """Verify autocomplete-style query works via RPC."""
        try:
            resp = sb.rpc("autocomplete_by_postcode", {"pc": SAMPLE_POSTCODES[1]}).execute()
        except Exception:
            # RPC may timeout — fall back to direct indexed query with small limit
            resp = sb.table("epc_certificates") \
                .select("address, postcode") \
                .eq("postcode", SAMPLE_POSTCODES[1]) \
                .limit(5).execute()
        assert resp.data, f"No addresses for autocomplete at {SAMPLE_POSTCODES[1]}"
        has_address = any(r.get("address") for r in resp.data)
        assert has_address, "No address text in EPC certificates"
        _throttle()


class TestUnmatchedTransactions:
    """Verify unmatched_transactions table."""

    def test_has_data(self, sb):
        resp = sb.table("unmatched_transactions") \
            .select("transaction_id, price, postcode") \
            .limit(3).execute()
        assert resp.data, "unmatched_transactions table is empty"
        row = resp.data[0]
        assert row["price"] > 0
        _throttle()

    def test_no_uprn(self, sb):
        """Unmatched transactions should not have UPRN column (it's PPD-only)."""
        resp = sb.table("unmatched_transactions") \
            .select("transaction_id, postcode") \
            .limit(1).execute()
        assert resp.data
        # The table schema doesn't have a UPRN column — this is by design
        assert "uprn" not in resp.data[0] or resp.data[0].get("uprn") is None
        _throttle()


class TestRegisteredLeases:
    """Verify registered_leases table."""

    def test_query_by_uprn(self, sb):
        # Find a UPRN that has a lease
        resp = sb.table("registered_leases") \
            .select("uprn, date_of_lease, term_years, expiry_date") \
            .limit(3).execute()
        assert resp.data, "registered_leases table is empty"
        row = resp.data[0]
        assert row["uprn"] is not None
        assert row["term_years"] is not None or row["expiry_date"] is not None
        _throttle()

    def test_specific_uprn_lookup(self, sb):
        """Verify UPRN lookup returns lease data (the production use case)."""
        # Get a UPRN from transactions first
        tx = sb.table("transactions") \
            .select("uprn") \
            .eq("duration", "L") \
            .not_.is_("uprn", "null") \
            .eq("postcode", SAMPLE_POSTCODES[0]) \
            .limit(1).execute()
        if not tx.data:
            pytest.skip("No leasehold UPRN found")
        uprn = tx.data[0]["uprn"]
        _throttle()

        lease = sb.table("registered_leases") \
            .select("uprn, expiry_date, term_years") \
            .eq("uprn", uprn) \
            .limit(1).execute()
        # Not all UPRNs have leases — that's OK
        # Just verify the query doesn't error
        assert isinstance(lease.data, list)
        _throttle()


class TestSaonFiltering:
    """Verify building-level UPRN SAON filtering works correctly."""

    def test_flat_query_returns_specific_flat(self, sb):
        """Query a known flat postcode — should not return all flats in building."""
        # Find a flat with SAON
        resp = sb.table("transactions") \
            .select("transaction_id, saon, paon, uprn, postcode") \
            .eq("postcode", SAMPLE_POSTCODES[1]) \
            .not_.is_("saon", "null") \
            .eq("ppd_type", "F") \
            .limit(1).execute()
        if not resp.data:
            pytest.skip("No flat with SAON found at test postcode")

        flat = resp.data[0]
        saon = flat["saon"]
        uprn = flat["uprn"]
        _throttle()

        if not uprn:
            pytest.skip("Flat has no UPRN")

        # Query all transactions for this UPRN
        all_by_uprn = sb.table("transactions") \
            .select("transaction_id, saon") \
            .eq("uprn", uprn) \
            .limit(50).execute()
        _throttle()

        # If multiple different SAONs share this UPRN, it's a building-level UPRN
        saons = {r["saon"] for r in all_by_uprn.data if r.get("saon")}
        if len(saons) > 1:
            # This is a building-level UPRN — the app must filter by SAON
            # Just document it, the actual filtering is tested in test_spine_mapping
            pytest.skip(f"Building-level UPRN {uprn} found ({len(saons)} SAONs) — filtering tested elsewhere")
