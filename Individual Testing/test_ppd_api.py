"""
Standalone test — HMLR Price Paid Data API call.
No dependencies on propval-mvp. Just run: python test_ppd_api.py
"""

import csv
import io
import httpx

HMLR_CSV_URL = "https://landregistry.data.gov.uk/app/ppd/ppd_data.csv"

def fetch_ppd(outward_code: str, limit: int = 50, filter_postcode: str = None):
    """
    Fetch PPD records from HMLR.

    Args:
        outward_code: e.g. "SM2" — the API only filters by outward code
        limit: max rows to fetch (use "all" in production)
        filter_postcode: optional full postcode to filter results client-side
    """
    params = {
        "limit": str(limit),
        "postcode": outward_code,
        "header": "true",
    }
    print(f"Fetching PPD for outward code: {outward_code} (limit={limit}) ...")
    resp = httpx.get(HMLR_CSV_URL, params=params, timeout=30.0)
    resp.raise_for_status()
    print(f"Status: {resp.status_code} | Size: {len(resp.text):,} bytes\n")

    reader = csv.DictReader(io.StringIO(resp.text))
    rows = list(reader)

    # Optional: filter to exact postcode
    if filter_postcode:
        rows = [r for r in rows if r["postcode"] == filter_postcode.upper()]
        print(f"Filtered to {filter_postcode}: {len(rows)} transactions\n")
    else:
        print(f"Got {len(rows)} transactions for {outward_code}\n")

    for i, row in enumerate(rows[:10], 1):
        price = int(row["price_paid"])
        print(f"--- Transaction {i} ---")
        print(f"  Price:    £{price:,}")
        print(f"  Date:     {row['deed_date']}")
        print(f"  Address:  {row['saon']} {row['paon']} {row['street']}, {row['town']}")
        print(f"  Postcode: {row['postcode']}")
        print(f"  Type:     {row['property_type']} ({'Detached' if row['property_type']=='D' else 'Semi' if row['property_type']=='S' else 'Terraced' if row['property_type']=='T' else 'Flat' if row['property_type']=='F' else 'Other'})")
        print(f"  Tenure:   {'Freehold' if row['estate_type']=='F' else 'Leasehold'}")
        print(f"  New:      {'Yes' if row['new_build']=='Y' else 'No'}")
        print()

    return rows


if __name__ == "__main__":
    fetch_ppd("SM1", limit=500, filter_postcode="SM1 2EG")
