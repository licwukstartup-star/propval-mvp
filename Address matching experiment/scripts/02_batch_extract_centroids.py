"""
Script 02b -- Batch Extract Centroids from All Borough GeoJSONs
===============================================================
Processes all inspire_{slug}.geojson files and produces:
  1. Per-borough centroid JSON (inspire_centroids_{slug}.json)
  2. A single merged inspire_centroids_london.json covering all boroughs

The merged file is the production-ready lookup for PropVal.

Input:  ../data/inspire_raw/inspire_{slug}.geojson  (one per borough)
Output: ../data/inspire_centroids_{slug}.json       (per borough)
        ../data/inspire_centroids_london.json        (merged, all London)
        ../data/inspire_centroids_london_summary.json
"""

import json
import sys
import time
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
INSPIRE_RAW_DIR = DATA_DIR / "inspire_raw"
MERGED_OUT = DATA_DIR / "inspire_centroids_london.json"
MERGED_SUMMARY_OUT = DATA_DIR / "inspire_centroids_london_summary.json"


def extract_centroids_for_borough(geojson_path: Path, centroids_out: Path) -> dict:
    """
    Load a borough GeoJSON, compute polygon centroids, save and return dict.
    Returns {} on failure.
    """
    try:
        import geopandas as gpd
        from pyproj import Geod
    except ImportError:
        print("ERROR: geopandas / pyproj not installed.")
        sys.exit(1)

    if centroids_out.exists():
        with open(centroids_out) as f:
            existing = json.load(f)
        return existing

    gdf = gpd.read_file(str(geojson_path))

    id_col = None
    for candidate in ["INSPIREID", "inspireid", "INSPIRE_ID", "inspire_id", "fid"]:
        if candidate in gdf.columns:
            id_col = candidate
            break

    geod = Geod(ellps="WGS84")
    centroids = {}
    skipped = 0

    for i, row in gdf.iterrows():
        try:
            geom = row.geometry
            if geom is None or geom.is_empty:
                skipped += 1
                continue
            centroid = geom.centroid
            area_m2, _ = geod.geometry_area_perimeter(geom)
            inspire_id = str(row[id_col]) if id_col else str(i)
            centroids[inspire_id] = {
                "lat": round(centroid.y, 6),
                "lng": round(centroid.x, 6),
                "area_sqm": round(abs(area_m2), 1),
            }
        except Exception:
            skipped += 1

    with open(centroids_out, "w") as f:
        json.dump(centroids, f, separators=(",", ":"))

    return centroids


def main():
    print("\n=== Script 02b: Batch Extract Centroids -> London Merged ===\n")

    # Find all borough GeoJSONs
    geojsons = sorted(INSPIRE_RAW_DIR.glob("inspire_*.geojson"))

    if not geojsons:
        print("  No inspire_*.geojson files found.")
        print("  Run Script 01b first: python scripts/01_batch_convert_inspire.py")
        return

    print(f"  Found {len(geojsons)} borough GeoJSON(s):\n")

    merged = {}
    total_polygons = 0

    for gj in geojsons:
        # slug = "bromley" from "inspire_bromley.geojson"
        slug = gj.stem.replace("inspire_", "")
        centroids_out = DATA_DIR / f"inspire_centroids_{slug}.json"

        if centroids_out.exists():
            with open(centroids_out) as f:
                borough_centroids = json.load(f)
            n = len(borough_centroids)
            print(f"  [CACHED] {slug:<30} {n:>8,} polygons")
        else:
            print(f"  Processing {slug}... ", end="", flush=True)
            t0 = time.time()
            borough_centroids = extract_centroids_for_borough(gj, centroids_out)
            n = len(borough_centroids)
            print(f"{n:,} polygons ({time.time()-t0:.0f}s)")

        merged.update(borough_centroids)
        total_polygons += n

    print(f"\n  Total polygons (all boroughs): {total_polygons:,}")

    # Check for duplicate INSPIRE IDs across boroughs (shouldn't happen but sanity check)
    if len(merged) < total_polygons:
        dups = total_polygons - len(merged)
        print(f"  Warning: {dups:,} duplicate INSPIRE IDs detected (deduped in merge)")

    print(f"\n  Writing merged file: {MERGED_OUT.name}...")
    with open(MERGED_OUT, "w") as f:
        json.dump(merged, f, separators=(",", ":"))

    size_mb = MERGED_OUT.stat().st_size / 1_048_576
    print(f"  [OK] {MERGED_OUT.name} ({size_mb:.1f} MB, {len(merged):,} unique polygons)")

    # Summary
    summary = {
        "boroughs_included": len(geojsons),
        "borough_slugs": [gj.stem.replace("inspire_", "") for gj in geojsons],
        "total_polygons": len(merged),
        "file_size_mb": round(size_mb, 1),
        "generated_at": __import__("datetime").datetime.now().isoformat(),
    }
    with open(MERGED_SUMMARY_OUT, "w") as f:
        json.dump(summary, f, indent=2)

    print(f"  [OK] Summary: {MERGED_SUMMARY_OUT.name}")
    print(f"\n  PRODUCTION FILE READY: {MERGED_OUT}")
    print(f"  This file can be loaded into Supabase inspire_centroids table.")
    print(f"  See EXPERIMENT_FINAL_SUMMARY.md -> Integration Plan for schema.")


if __name__ == "__main__":
    main()
