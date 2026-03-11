"""
Script 03 -- Fetch PPD Transactions & Postcode Centroids
========================================================
Queries HM Land Registry Price Paid Data via SPARQL for a set of
Sutton postcodes. Also fetches postcode centroids from postcodes.io.

All sources are 100% free, no API keys required:
  - HMLR SPARQL endpoint: http://landregistry.data.gov.uk/landregistry/query
  - postcodes.io: https://api.postcodes.io

Test area: Bromley, South East London (LA: E09000006)
Postcodes chosen to give a mix of suburban semis, detached, and some flats.
Bromley is a large, low-density outer London borough -- postcodes cover
even wider areas than Sutton. Expected postcode centroid error: 150-400m.

Output:
  ../data/ppd_transactions_bromley.json      -- all PPD transactions
  ../data/postcode_centroids_bromley.json    -- postcodes.io lat/lng per postcode
"""

import json
import time
from pathlib import Path

import requests

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

PPD_OUT = DATA_DIR / "ppd_transactions_bromley.json"
POSTCODE_OUT = DATA_DIR / "postcode_centroids_bromley.json"

SPARQL_ENDPOINT = "http://landregistry.data.gov.uk/landregistry/query"

# Bromley postcodes: outer south-east London -- large postcodes covering
# suburban streets and some semi-rural areas.
# BR1 = Bromley town centre / Shortlands
# BR2 = Hayes / Keston / Bickley
# BR3 = Beckenham / Elmers End
# BR4 = West Wickham
# BR5 = Orpington / St Mary Cray / Petts Wood
# BR6 = Orpington / Farnborough / Chelsfield
# BR7 = Chislehurst / Mottingham
TEST_POSTCODES = [
    # BR1 -- Bromley town centre and surrounds
    "BR1 1AA", "BR1 1DP", "BR1 1LY",
    "BR1 2AA", "BR1 2JH", "BR1 2QP",
    "BR1 3AA", "BR1 3DT", "BR1 3LB",
    "BR1 4AA", "BR1 4JN", "BR1 4QU",
    "BR1 5AA", "BR1 5HE", "BR1 5NJ",
    # BR2 -- Hayes, Keston, Bickley (large plots)
    "BR2 0AA", "BR2 0DH", "BR2 0LT",
    "BR2 6AA", "BR2 6DU", "BR2 6NE",
    "BR2 7AA", "BR2 7EJ", "BR2 7QA",
    "BR2 8AA", "BR2 8HN", "BR2 8QR",
    # BR3 -- Beckenham (terrace and semi mix)
    "BR3 1AA", "BR3 1HE", "BR3 1QP",
    "BR3 3AA", "BR3 3DQ", "BR3 3NG",
    "BR3 4AA", "BR3 4HR", "BR3 4QX",
    # BR5 -- Orpington / Petts Wood
    "BR5 1AA", "BR5 1DL", "BR5 1NJ",
    "BR5 2AA", "BR5 2ET", "BR5 2QH",
    "BR5 3AA", "BR5 3HL", "BR5 3QN",
    # BR6 -- Farnborough / Chelsfield (wide semi-rural postcodes)
    "BR6 0AA", "BR6 0EL", "BR6 0QD",
    "BR6 6AA", "BR6 6ET", "BR6 6QJ",
    "BR6 7AA", "BR6 7EF", "BR6 7QP",
    "BR6 8AA", "BR6 8DQ", "BR6 8NE",
    # BR7 -- Chislehurst
    "BR7 5AA", "BR7 5EN", "BR7 5QH",
    "BR7 6AA", "BR7 6DH", "BR7 6NR",
]

SPARQL_TEMPLATE = """
PREFIX lrppi: <http://landregistry.data.gov.uk/def/ppi/>
PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

SELECT ?paon ?saon ?street ?town ?postcode ?amount ?date ?propertyType
WHERE {{
  ?txn lrppi:propertyAddress ?addr ;
       lrppi:pricePaid ?amount ;
       lrppi:transactionDate ?date ;
       lrppi:propertyType/skos:prefLabel ?propertyType .

  ?addr lrcommon:postcode "{postcode}" .

  OPTIONAL {{ ?addr lrcommon:paon ?paon }}
  OPTIONAL {{ ?addr lrcommon:saon ?saon }}
  OPTIONAL {{ ?addr lrcommon:street ?street }}
  OPTIONAL {{ ?addr lrcommon:town ?town }}

  FILTER (?date >= "2019-01-01"^^xsd:date)
}}
ORDER BY DESC(?date)
LIMIT 200
"""


def sparql_query(postcode: str) -> list[dict]:
    """Query HMLR SPARQL for PPD transactions in a postcode."""
    query = SPARQL_TEMPLATE.format(postcode=postcode)
    headers = {"Accept": "application/sparql-results+json"}
    params = {"query": query}

    try:
        r = requests.get(
            SPARQL_ENDPOINT,
            params=params,
            headers=headers,
            timeout=30,
        )
        r.raise_for_status()
        data = r.json()
        bindings = data.get("results", {}).get("bindings", [])
        transactions = []
        for b in bindings:
            transactions.append({
                "paon": b.get("paon", {}).get("value", ""),
                "saon": b.get("saon", {}).get("value", ""),
                "street": b.get("street", {}).get("value", ""),
                "town": b.get("town", {}).get("value", ""),
                "postcode": postcode,
                "amount": int(b["amount"]["value"]) if "amount" in b else None,
                "date": b.get("date", {}).get("value", ""),
                "property_type": b.get("propertyType", {}).get("value", ""),
            })
        return transactions
    except requests.exceptions.Timeout:
        print(f"    TIMEOUT for {postcode} -- skipping")
        return []
    except Exception as e:
        print(f"    ERROR for {postcode}: {e}")
        return []


def get_postcode_centroid(postcode: str) -> dict | None:
    """Get lat/lng centroid for a postcode via postcodes.io (free, no key)."""
    clean = postcode.replace(" ", "")
    try:
        r = requests.get(
            f"https://api.postcodes.io/postcodes/{clean}",
            timeout=10,
        )
        if r.status_code == 200:
            result = r.json()["result"]
            return {
                "lat": result["latitude"],
                "lng": result["longitude"],
                "postcode": result["postcode"],
                "lsoa": result.get("lsoa", ""),
                "ward": result.get("admin_ward", ""),
            }
    except Exception as e:
        print(f"    postcodes.io error for {postcode}: {e}")
    return None


def build_address(txn: dict) -> str:
    """Build a human-readable address string from PPD fields."""
    parts = []
    if txn["saon"]:
        parts.append(txn["saon"])
    if txn["paon"]:
        parts.append(txn["paon"])
    if txn["street"]:
        parts.append(txn["street"].title())
    parts.append(txn["postcode"])
    return ", ".join(p for p in parts if p)


def main():
    print("\n=== Script 03: Fetch PPD Transactions & Postcode Centroids ===\n")

    if PPD_OUT.exists() and POSTCODE_OUT.exists():
        with open(PPD_OUT) as f:
            existing = json.load(f)
        print(f"[OK] PPD data already fetched: {len(existing):,} transactions")
        print("  Delete ppd_transactions_bromley.json to re-fetch.")
        print("\n  -> Run Script 04 next: python scripts/04_match_and_compare.py")
        return

    # --- Fetch PPD transactions ---
    all_transactions = []
    print(f"  Querying HMLR SPARQL for {len(TEST_POSTCODES)} postcodes (Bromley)...\n")

    for postcode in TEST_POSTCODES:
        print(f"  [{postcode}] ", end="", flush=True)
        txns = sparql_query(postcode)
        print(f"{len(txns)} transactions")
        all_transactions.extend(txns)
        time.sleep(1)  # polite pause between queries

    # Deduplicate (same property sold multiple times -- keep all, they're valid comparables)
    print(f"\n  Total transactions fetched: {len(all_transactions):,}")

    # Add derived address field for geocoding
    for txn in all_transactions:
        txn["address_string"] = build_address(txn)

    # Property type breakdown
    from collections import Counter
    types = Counter(t["property_type"] for t in all_transactions)
    print("\n  Property type breakdown:")
    for ptype, count in types.most_common():
        print(f"    {ptype:<30} {count:>4}")

    with open(PPD_OUT, "w") as f:
        json.dump(all_transactions, f, indent=2)
    print(f"\n  [OK] Saved: {PPD_OUT.name} ({len(all_transactions):,} transactions)")

    # --- Fetch postcode centroids ---
    print(f"\n  Fetching postcode centroids from postcodes.io...")
    postcode_centroids = {}

    for postcode in TEST_POSTCODES:
        print(f"  [{postcode}] ", end="", flush=True)
        centroid = get_postcode_centroid(postcode)
        if centroid:
            postcode_centroids[postcode] = centroid
            print(f"lat={centroid['lat']:.5f}, lng={centroid['lng']:.5f}")
        else:
            print("FAILED")
        time.sleep(0.5)

    with open(POSTCODE_OUT, "w") as f:
        json.dump(postcode_centroids, f, indent=2)
    print(f"\n  [OK] Saved: {POSTCODE_OUT.name} ({len(postcode_centroids)} postcodes)")
    print(f"\n  -> Run Script 04 next: python scripts/04_match_and_compare.py")


if __name__ == "__main__":
    main()
