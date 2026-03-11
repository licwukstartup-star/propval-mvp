"""
Script 01b -- Batch Convert All Downloaded INSPIRE Zips to GeoJSON
==================================================================
Finds all {gss}_{slug}.zip files in data/inspire_raw/ and converts each
to inspire_{slug}.geojson (EPSG:27700 -> EPSG:4326).

Skips boroughs already converted (GeoJSON exists).
Safe to re-run at any time.

Input:  ../data/inspire_raw/{gss}_{slug}.zip
Output: ../data/inspire_raw/inspire_{slug}.geojson

After conversion, run Script 02 for each GeoJSON, or use the batch
centroid extraction below.
"""

import sys
import zipfile
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data" / "inspire_raw"


def extract_and_convert(zip_path: Path, geojson_out: Path):
    """Extract GML from zip and convert to WGS84 GeoJSON."""
    try:
        import geopandas as gpd
    except ImportError:
        print("ERROR: geopandas not installed. Run: pip install geopandas pyogrio")
        sys.exit(1)

    # Extract zip (keep GML + XSD together in a temp subdir)
    extract_dir = zip_path.parent / f"_tmp_{zip_path.stem}"
    extract_dir.mkdir(exist_ok=True)

    print(f"    Extracting {zip_path.name}...")
    with zipfile.ZipFile(zip_path, "r") as z:
        z.extractall(extract_dir)

    gmls = list(extract_dir.glob("*.gml")) + list(extract_dir.glob("*.GML"))
    if not gmls:
        print(f"    ERROR: No GML found in {zip_path.name}")
        import shutil; shutil.rmtree(extract_dir, ignore_errors=True)
        return False

    gml_path = gmls[0]
    print(f"    Reading GML ({gml_path.name})... (may take 30-120s)")

    gdf = None
    for engine in ["pyogrio", None]:
        try:
            kwargs = {"engine": engine} if engine else {}
            gdf = gpd.read_file(str(gml_path), **kwargs)
            break
        except Exception as e:
            if engine:
                continue
            print(f"    ERROR reading GML: {e}")
            import shutil; shutil.rmtree(extract_dir, ignore_errors=True)
            return False

    print(f"    Loaded {len(gdf):,} polygons (CRS: {gdf.crs})")

    if gdf.crs and gdf.crs.to_epsg() != 4326:
        print(f"    Reprojecting to WGS84...")
        gdf = gdf.to_crs(epsg=4326)

    before = len(gdf)
    gdf = gdf[gdf.geometry.notnull() & gdf.geometry.is_valid]
    if len(gdf) < before:
        print(f"    Dropped {before - len(gdf):,} invalid geometries")

    print(f"    Writing GeoJSON...")
    gdf.to_file(str(geojson_out), driver="GeoJSON")
    size_mb = geojson_out.stat().st_size / 1_048_576
    print(f"    [OK] {geojson_out.name} ({size_mb:.1f} MB, {len(gdf):,} polygons)")

    # Clean up temp dir
    import shutil
    shutil.rmtree(extract_dir, ignore_errors=True)
    return True


def main():
    print("\n=== Script 01b: Batch Convert INSPIRE Zips -> GeoJSON ===\n")

    # Known slugs from Script 00 (plain-named zips e.g. bromley.zip)
    KNOWN_SLUGS = {
        "city_of_london", "barking_and_dagenham", "barnet", "bexley", "brent",
        "bromley", "camden", "croydon", "ealing", "enfield", "greenwich",
        "hackney", "hammersmith_and_fulham", "haringey", "harrow", "havering",
        "hillingdon", "hounslow", "islington", "kensington_and_chelsea",
        "kingston_upon_thames", "lambeth", "lewisham", "merton", "newham",
        "redbridge", "richmond_upon_thames", "southwark", "sutton",
        "tower_hamlets", "waltham_forest", "wandsworth", "westminster",
    }

    # Find GSS-prefixed zips (E09000006_bromley.zip) AND plain slug zips (bromley.zip)
    gss_zips = sorted(DATA_DIR.glob("E??????_*.zip"))
    slug_zips = sorted(z for z in DATA_DIR.glob("*.zip")
                       if z.stem in KNOWN_SLUGS)
    zips = gss_zips + [z for z in slug_zips if z not in gss_zips]

    if not zips:
        print("  No borough zips found.")
        print("  Run Script 00 first: python scripts/00_batch_download_inspire.py")
        return

    print(f"  Found {len(zips)} zip(s) to process:\n")

    converted = 0
    skipped = 0
    failed = 0

    for zip_path in zips:
        # Derive slug: E09000006_bromley.zip -> bromley, bromley.zip -> bromley
        if zip_path.stem.startswith("E0") and "_" in zip_path.stem:
            slug = zip_path.stem.split("_", 1)[1]
        else:
            slug = zip_path.stem

        geojson_out = DATA_DIR / f"inspire_{slug}.geojson"

        if geojson_out.exists():
            size_mb = geojson_out.stat().st_size / 1_048_576
            print(f"  [SKIP] {slug} — GeoJSON exists ({size_mb:.1f} MB)")
            skipped += 1
            continue

        print(f"\n  Processing: {zip_path.name}")
        ok = extract_and_convert(zip_path, geojson_out)
        if ok:
            converted += 1
        else:
            failed += 1

    print(f"\n  ========================================")
    print(f"  Converted: {converted}  Skipped: {skipped}  Failed: {failed}")
    print(f"  GeoJSON files in: {DATA_DIR}")
    if converted + skipped > 0:
        print(f"\n  Next step: python scripts/02_batch_extract_centroids.py")


if __name__ == "__main__":
    main()
