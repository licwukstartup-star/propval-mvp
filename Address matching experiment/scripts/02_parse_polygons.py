"""
Script 02 -- Parse INSPIRE Polygons -> Extract Centroids
=======================================================
Loads the GeoJSON produced by Script 01, computes the centroid of every
freehold title polygon, and saves a fast-lookup JSON.

Uses pyproj Geod for accurate geodesic area (avoids degree² nonsense).
Centroid is computed in WGS84 -- for house-sized plots the geometric error
vs true geodesic centroid is sub-metre, which is negligible for our purpose.

Input:  ../data/inspire_raw/inspire_bromley.geojson
Output: ../data/inspire_centroids_bromley.json
        ../data/inspire_centroids_bromley_summary.json
"""

import json
import sys
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
GEOJSON_IN = BASE_DIR / "data" / "inspire_raw" / "inspire_bromley.geojson"
CENTROIDS_OUT = BASE_DIR / "data" / "inspire_centroids_bromley.json"
SUMMARY_OUT = BASE_DIR / "data" / "inspire_centroids_bromley_summary.json"


def find_inspire_id_column(gdf) -> str | None:
    """HMLR INSPIRE GML uses inconsistent column names across GDAL versions."""
    for candidate in ["INSPIREID", "inspireid", "INSPIRE_ID", "inspire_id",
                       "fid", "gml_id", "id"]:
        if candidate in gdf.columns:
            return candidate
    return None


def main():
    print("\n=== Script 02: Parse INSPIRE Polygons -> Centroids ===\n")

    if not GEOJSON_IN.exists():
        print(f"ERROR: GeoJSON not found: {GEOJSON_IN}")
        print("  Run Script 01 first: python scripts/01_download_inspire.py")
        sys.exit(1)

    if CENTROIDS_OUT.exists():
        with open(CENTROIDS_OUT) as f:
            existing = json.load(f)
        print(f"[OK] Centroids already computed: {len(existing):,} polygons")
        print("  Delete inspire_centroids.json to recompute.")
        print("\n  -> Run Script 03 next: python scripts/03_fetch_ppd.py")
        return

    try:
        import geopandas as gpd
        from pyproj import Geod
    except ImportError as e:
        print(f"ERROR: Missing dependency -- {e}")
        print("Install: pip install geopandas pyogrio pyproj")
        sys.exit(1)

    print(f"  Loading: {GEOJSON_IN.name}")
    print("  (May take 20–60 seconds for large files...)")
    gdf = gpd.read_file(str(GEOJSON_IN))
    print(f"  Loaded {len(gdf):,} polygons")

    id_col = find_inspire_id_column(gdf)
    if id_col:
        print(f"  INSPIRE ID column: '{id_col}'")
    else:
        print("  No INSPIRE ID column found -- using row index as ID")

    geod = Geod(ellps="WGS84")

    centroids = {}
    area_values = []
    skipped = 0

    print(f"  Computing centroids and areas for {len(gdf):,} polygons...")
    for i, row in gdf.iterrows():
        try:
            geom = row.geometry
            if geom is None or geom.is_empty:
                skipped += 1
                continue

            centroid = geom.centroid
            area_m2, _ = geod.geometry_area_perimeter(geom)
            area_m2 = abs(area_m2)

            inspire_id = str(row[id_col]) if id_col else str(i)
            centroids[inspire_id] = {
                "lat": round(centroid.y, 6),
                "lng": round(centroid.x, 6),
                "area_sqm": round(area_m2, 1),
            }
            area_values.append(area_m2)

        except Exception:
            skipped += 1
            continue

        if (i + 1) % 10_000 == 0:
            print(f"  Progress: {i + 1:,} / {len(gdf):,}")

    print(f"\n  [OK] Computed {len(centroids):,} centroids")
    if skipped:
        print(f"  Skipped {skipped:,} null/empty geometries")

    # Area distribution summary
    if area_values:
        import statistics
        areas_sorted = sorted(area_values)
        n = len(areas_sorted)
        summary = {
            "total_polygons": len(centroids),
            "skipped": skipped,
            "area_sqm": {
                "min": round(areas_sorted[0], 1),
                "p10": round(areas_sorted[n // 10], 1),
                "median": round(statistics.median(area_values), 1),
                "p90": round(areas_sorted[int(n * 0.9)], 1),
                "max": round(areas_sorted[-1], 1),
                "mean": round(statistics.mean(area_values), 1),
            },
            "residential_range_note": (
                "Typical UK residential plots: 50–500 sqm. "
                "Large polygons (>2000 sqm) are likely commercial/industrial."
            )
        }
        print(f"\n  Area distribution (sqm):")
        print(f"    Min:    {summary['area_sqm']['min']:>10,.0f}")
        print(f"    P10:    {summary['area_sqm']['p10']:>10,.0f}")
        print(f"    Median: {summary['area_sqm']['median']:>10,.0f}")
        print(f"    P90:    {summary['area_sqm']['p90']:>10,.0f}")
        print(f"    Max:    {summary['area_sqm']['max']:>10,.0f}")

    print(f"\n  Saving: {CENTROIDS_OUT.name}")
    with open(CENTROIDS_OUT, "w") as f:
        json.dump(centroids, f, separators=(",", ":"))

    with open(SUMMARY_OUT, "w") as f:
        json.dump(summary, f, indent=2)

    size_kb = CENTROIDS_OUT.stat().st_size / 1024
    print(f"  [OK] Saved {len(centroids):,} centroids ({size_kb:.0f} KB)")
    print(f"  [OK] Summary saved: {SUMMARY_OUT.name}")
    print(f"\n  -> Run Script 03 next: python scripts/03_fetch_ppd.py")


if __name__ == "__main__":
    main()
