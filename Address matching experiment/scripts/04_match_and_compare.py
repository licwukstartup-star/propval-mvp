"""
Script 04 -- Spatial Matching & Error Measurement
=================================================
For each PPD transaction:
  1. Geocode the address using Nominatim (OpenStreetMap) -- free, no key
  2. Find which INSPIRE polygon contains the Nominatim coordinate (point-in-polygon)
  3. Get the INSPIRE polygon centroid
  4. Get the postcode centroid (from postcodes.io via Script 03)
  5. Compute distances:
       error_postcode  = haversine(Nominatim coord, postcode centroid)
       error_inspire   = haversine(Nominatim coord, INSPIRE polygon centroid)
       improvement     = error_postcode - error_inspire

Ground truth: Nominatim (OpenStreetMap geocoder)
  Free, no API key. Rate limit: 1 req/sec. Typical accuracy: 5–30m for
  specific addresses in London. Good enough to demonstrate 100–300m
  postcode centroid error vs ~10m polygon centroid error.

Intermediate results are cached to disk -- safe to re-run after interruption.

Input:
  ../data/ppd_transactions_bromley.json
  ../data/postcode_centroids_bromley.json
  ../data/inspire_raw/inspire_bromley.geojson

Output:
  ../data/geocoded_cache_bromley.json   -- Nominatim results (cached)
  ../results/error_comparison_table_bromley.csv
"""

import csv
import json
import sys
import time
from math import atan2, cos, radians, sin, sqrt
from pathlib import Path

import requests

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
RESULTS_DIR = BASE_DIR / "results"
RESULTS_DIR.mkdir(exist_ok=True)

PPD_FILE = DATA_DIR / "ppd_transactions_bromley.json"
POSTCODE_FILE = DATA_DIR / "postcode_centroids_bromley.json"
GEOJSON_FILE = DATA_DIR / "inspire_raw" / "inspire_bromley.geojson"
GEOCODE_CACHE = DATA_DIR / "geocoded_cache_bromley.json"
OUTPUT_CSV = RESULTS_DIR / "error_comparison_table_bromley.csv"

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "INSPIRE-Experiment/1.0 (academic geocoding accuracy research; non-commercial)"


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine distance in metres between two WGS84 coordinates."""
    R = 6_371_000
    phi1, phi2 = radians(lat1), radians(lat2)
    dphi = radians(lat2 - lat1)
    dlambda = radians(lon2 - lon1)
    a = sin(dphi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(dlambda / 2) ** 2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))


def geocode_nominatim(address: str, cache: dict) -> dict | None:
    """
    Geocode an address using Nominatim. Results are cached to disk.
    Rate limit: 1 request/second (enforced below).
    """
    if address in cache:
        return cache[address]

    params = {
        "q": address,
        "format": "json",
        "limit": 1,
        "countrycodes": "gb",
        "addressdetails": 1,
    }
    headers = {"User-Agent": USER_AGENT}

    try:
        r = requests.get(NOMINATIM_URL, params=params, headers=headers, timeout=10)
        r.raise_for_status()
        results = r.json()
        if results:
            result = {
                "lat": float(results[0]["lat"]),
                "lng": float(results[0]["lon"]),
                "display_name": results[0]["display_name"],
                "osm_type": results[0].get("type", ""),
                "importance": float(results[0].get("importance", 0)),
            }
            cache[address] = result
            return result
        else:
            cache[address] = None
            return None
    except Exception as e:
        print(f"    Nominatim error: {e}")
        return None


def load_inspire_polygons():
    """
    Load INSPIRE GeoJSON and build a Shapely STRtree spatial index.
    Returns (gdf, tree, id_col).
    """
    try:
        import geopandas as gpd
        from shapely.strtree import STRtree
    except ImportError:
        print("ERROR: geopandas or shapely not installed.")
        print("Install: pip install geopandas pyogrio shapely")
        sys.exit(1)

    if not GEOJSON_FILE.exists():
        print(f"ERROR: GeoJSON not found: {GEOJSON_FILE}")
        print("  Run Script 01 first.")
        sys.exit(1)

    print(f"  Loading INSPIRE polygons: {GEOJSON_FILE.name}")
    print("  (May take 20–60 seconds...)")
    gdf = gpd.read_file(str(GEOJSON_FILE))
    print(f"  Loaded {len(gdf):,} polygons")

    # Find the INSPIRE ID column
    id_col = None
    for candidate in ["INSPIREID", "inspireid", "INSPIRE_ID", "inspire_id", "fid"]:
        if candidate in gdf.columns:
            id_col = candidate
            break

    print(f"  Building spatial index (STRtree)...")
    tree = STRtree(gdf.geometry.values)
    print(f"  Spatial index ready")

    return gdf, tree, id_col


def find_polygon_centroid(lat: float, lng: float, gdf, tree, id_col) -> dict | None:
    """
    Find which INSPIRE polygon contains the given coordinate.
    Returns centroid of the matched polygon, or None if no match.
    """
    from shapely.geometry import Point

    point = Point(lng, lat)  # Shapely: (x=lng, y=lat)

    # STRtree spatial index query (Shapely 2.0 API)
    try:
        candidate_indices = tree.query(point, predicate="contains")
    except TypeError:
        # Fallback for older Shapely
        candidate_indices = [i for i in tree.query(point)
                             if gdf.geometry.iloc[i].contains(point)]

    if len(candidate_indices) == 0:
        # Point not inside any polygon -- try nearest (handles edge cases)
        nearest = tree.nearest(point)
        if nearest is not None:
            row = gdf.iloc[nearest]
            dist_to_nearest = point.distance(row.geometry)
            if dist_to_nearest < 0.0002:  # ~20m in degrees -- close enough
                centroid = row.geometry.centroid
                inspire_id = str(row[id_col]) if id_col else str(nearest)
                return {
                    "inspire_id": inspire_id,
                    "centroid_lat": round(centroid.y, 6),
                    "centroid_lng": round(centroid.x, 6),
                    "match_type": "nearest",
                    "dist_to_polygon": round(dist_to_nearest * 111_320, 1),
                }
        return None

    idx = candidate_indices[0]
    row = gdf.iloc[idx]
    centroid = row.geometry.centroid
    inspire_id = str(row[id_col]) if id_col else str(idx)

    return {
        "inspire_id": inspire_id,
        "centroid_lat": round(centroid.y, 6),
        "centroid_lng": round(centroid.x, 6),
        "match_type": "contains",
        "dist_to_polygon": 0.0,
    }


def save_cache(cache: dict):
    with open(GEOCODE_CACHE, "w") as f:
        json.dump(cache, f, indent=2)


def main():
    print("\n=== Script 04: Spatial Matching & Error Measurement ===\n")

    # Check outputs
    if OUTPUT_CSV.exists():
        with open(OUTPUT_CSV) as f:
            rows = sum(1 for _ in f) - 1
        print(f"[OK] Results already computed: {rows} rows in error_comparison_table_bromley.csv")
        print("  Delete the file to recompute.")
        print("\n  -> Run Script 05 next: python scripts/05_ranking_test.py")
        return

    # Load inputs
    if not PPD_FILE.exists():
        print("ERROR: ppd_transactions.json not found.")
        print("  Run Script 03 first.")
        sys.exit(1)

    with open(PPD_FILE) as f:
        transactions = json.load(f)
    print(f"  PPD transactions loaded: {len(transactions):,}")

    with open(POSTCODE_FILE) as f:
        postcode_centroids = json.load(f)
    print(f"  Postcode centroids loaded: {len(postcode_centroids)}")

    # Load geocode cache (allows resume after interruption)
    cache = {}
    if GEOCODE_CACHE.exists():
        with open(GEOCODE_CACHE) as f:
            cache = json.load(f)
        print(f"  Geocode cache loaded: {len(cache)} entries")

    # Load INSPIRE polygons + spatial index
    gdf, tree, id_col = load_inspire_polygons()

    # Process transactions
    print(f"\n  Processing {len(transactions):,} transactions...")
    print(f"  Geocoding with Nominatim (1 req/sec, this will take ~{len(transactions)} seconds)\n")

    results = []
    failed_geocode = 0
    failed_polygon = 0
    geocode_calls = 0

    for i, txn in enumerate(transactions):
        address = txn["address_string"]
        postcode = txn["postcode"]

        # Geocode
        in_cache = address in cache
        coord = geocode_nominatim(address, cache)

        if not in_cache:
            geocode_calls += 1
            if geocode_calls % 10 == 0:
                save_cache(cache)  # persist cache every 10 new lookups
            time.sleep(1.1)  # Nominatim: 1 req/sec rate limit

        if coord is None:
            failed_geocode += 1
            if (i + 1) % 10 == 0:
                print(f"  Progress: {i + 1}/{len(transactions)} -- "
                      f"matched: {len(results)}, "
                      f"geocode_fail: {failed_geocode}, "
                      f"polygon_fail: {failed_polygon}")
            continue

        # Postcode centroid
        pc_data = postcode_centroids.get(postcode)
        if pc_data is None:
            failed_polygon += 1
            continue

        # INSPIRE polygon centroid (point-in-polygon)
        polygon_match = find_polygon_centroid(
            coord["lat"], coord["lng"], gdf, tree, id_col
        )
        if polygon_match is None:
            failed_polygon += 1
            continue

        # Compute errors
        error_postcode = haversine_m(
            coord["lat"], coord["lng"],
            pc_data["lat"], pc_data["lng"],
        )
        error_inspire = haversine_m(
            coord["lat"], coord["lng"],
            polygon_match["centroid_lat"], polygon_match["centroid_lng"],
        )

        results.append({
            "address": address,
            "postcode": postcode,
            "property_type": txn.get("property_type", ""),
            "sale_amount": txn.get("amount", ""),
            "sale_date": txn.get("date", ""),

            # Ground truth (Nominatim)
            "nominatim_lat": coord["lat"],
            "nominatim_lng": coord["lng"],
            "nominatim_display": coord["display_name"][:80],

            # Postcode centroid
            "postcode_lat": pc_data["lat"],
            "postcode_lng": pc_data["lng"],
            "error_postcode_m": round(error_postcode, 1),

            # INSPIRE polygon centroid
            "inspire_id": polygon_match["inspire_id"],
            "inspire_centroid_lat": polygon_match["centroid_lat"],
            "inspire_centroid_lng": polygon_match["centroid_lng"],
            "inspire_match_type": polygon_match["match_type"],
            "error_inspire_m": round(error_inspire, 1),

            # Key metrics
            "improvement_m": round(error_postcode - error_inspire, 1),
            "improvement_pct": round(
                (error_postcode - error_inspire) / error_postcode * 100, 1
            ) if error_postcode > 0 else 0,
        })

        if (i + 1) % 10 == 0:
            print(f"  Progress: {i + 1}/{len(transactions)} -- "
                  f"matched: {len(results)}, "
                  f"geocode_fail: {failed_geocode}, "
                  f"polygon_fail: {failed_polygon}")

    # Final cache save
    save_cache(cache)

    # Summary stats
    if not results:
        print("\nERROR: No results computed. Check geocoding and INSPIRE data.")
        sys.exit(1)

    errors_pc = [r["error_postcode_m"] for r in results]
    errors_in = [r["error_inspire_m"] for r in results]
    improvements = [r["improvement_m"] for r in results]

    n = len(results)
    print(f"\n  ===========================================")
    print(f"  RESULTS SUMMARY ({n} matched transactions)")
    print(f"  ===========================================")
    print(f"  {'Metric':<35} {'Postcode':>12} {'INSPIRE':>12}")
    print(f"  {'-'*59}")
    print(f"  {'Mean error (m)':<35} {sum(errors_pc)/n:>12.1f} {sum(errors_in)/n:>12.1f}")
    print(f"  {'Median error (m)':<35} {sorted(errors_pc)[n//2]:>12.1f} {sorted(errors_in)[n//2]:>12.1f}")
    print(f"  {'Max error (m)':<35} {max(errors_pc):>12.1f} {max(errors_in):>12.1f}")
    print(f"  {'% within 20m':<35} {sum(e<=20 for e in errors_pc)/n*100:>11.0f}% {sum(e<=20 for e in errors_in)/n*100:>11.0f}%")
    print(f"  {'% within 50m':<35} {sum(e<=50 for e in errors_pc)/n*100:>11.0f}% {sum(e<=50 for e in errors_in)/n*100:>11.0f}%")
    print(f"  {'% within 100m':<35} {sum(e<=100 for e in errors_pc)/n*100:>11.0f}% {sum(e<=100 for e in errors_in)/n*100:>11.0f}%")
    mean_improvement = sum(improvements) / n
    pct_improved = sum(1 for x in improvements if x > 0) / n * 100
    print(f"\n  Mean improvement: {mean_improvement:.1f}m")
    print(f"  INSPIRE beats postcode in: {pct_improved:.0f}% of cases")
    print(f"  Failed geocoding: {failed_geocode}")
    print(f"  Failed polygon match: {failed_polygon}")

    # Write CSV
    print(f"\n  Writing: {OUTPUT_CSV.name}")
    fieldnames = list(results[0].keys())
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(results)

    print(f"  [OK] Saved {len(results)} rows to {OUTPUT_CSV.name}")
    print(f"\n  -> Run Script 05 next: python scripts/05_ranking_test.py")


if __name__ == "__main__":
    main()
