"""
Script 01 -- Download & Convert INSPIRE Index Polygons (Hackney)
===============================================================
INSPIRE Index Polygons: Free, OGL-licensed freehold title boundary shapes
from HM Land Registry. Updated monthly. No login or API key required.

This script:
  1. Guides you to manually download the Hackney GML zip from HMLR
  2. Extracts the GML from the zip
  3. Reads the GML with geopandas (pyogrio backend, falls back to fiona)
  4. Reprojects from EPSG:27700 (British National Grid) -> EPSG:4326 (WGS84)
  5. Saves as GeoJSON for downstream scripts

Output: ../data/inspire_raw/inspire_hackney.geojson

All data is OGL-licensed. Attribution:
  "This information is subject to Crown copyright and database rights [2026]
   and is reproduced with the permission of HM Land Registry. The polygons
   © Crown copyright and database rights [2026] Ordnance Survey AC0000807064."
"""

import sys
import zipfile
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data" / "inspire_raw"
DATA_DIR.mkdir(parents=True, exist_ok=True)

GEOJSON_OUT = DATA_DIR / "inspire_bromley.geojson"

DOWNLOAD_INSTRUCTIONS = f"""
+======================================================================+
|          INSPIRE Index Polygons -- Manual Download Required           |
+======================================================================+

Step 1: Open this URL in your browser:
        https://use-land-property-data.service.gov.uk/datasets/inspire/download

Step 2: On the interactive map, click on BROMLEY (South East London).
        GSS code: E09000006

Step 3: Accept the OGL licence terms (free, no login required).

Step 4: Download the .zip file.

Step 5: Save the zip file (do not rename it) into this folder:
        {DATA_DIR}

Step 6: Re-run this script.

Expected filename:  Land_Registry_Cadastral_Parcels_*.zip  or similar
Expected zip size:  30–100 MB
Expected GML size:  80–200 MB (unzipped)

The zip contains the GML + XSD schema files. Leave them together --
GDAL needs the XSD to correctly parse the feature types.
"""


def find_zip() -> Path | None:
    zips = list(DATA_DIR.glob("*.zip"))
    return zips[0] if zips else None


def find_gml() -> Path | None:
    gmls = list(DATA_DIR.glob("*.gml")) + list(DATA_DIR.glob("*.GML"))
    return gmls[0] if gmls else None


def extract_zip(zip_path: Path) -> Path | None:
    print(f"  Extracting: {zip_path.name}")
    with zipfile.ZipFile(zip_path, "r") as z:
        members = z.namelist()
        print(f"  Contents: {', '.join(members)}")
        z.extractall(DATA_DIR)  # extract all -- keeps GML + XSD together
    gml = find_gml()
    if gml:
        print(f"  GML file: {gml.name}")
    return gml


def convert_gml_to_geojson(gml_path: Path):
    try:
        import geopandas as gpd
    except ImportError:
        print("\nERROR: geopandas is not installed.")
        print("Install with:  pip install geopandas pyogrio shapely pyproj")
        sys.exit(1)

    print(f"\n  Reading GML: {gml_path.name}")
    print("  (May take 30–120 seconds for a large borough file...)")

    # Try pyogrio first (faster), fall back to fiona
    gdf = None
    for engine in ["pyogrio", None]:
        try:
            kwargs = {"engine": engine} if engine else {}
            gdf = gpd.read_file(str(gml_path), **kwargs)
            used = engine or "fiona"
            print(f"  Read with engine: {used}")
            break
        except Exception as e:
            if engine == "pyogrio":
                print(f"  pyogrio failed ({e}), trying fiona...")
            else:
                print(f"  ERROR: Could not read GML -- {e}")
                sys.exit(1)

    print(f"  Polygons loaded: {len(gdf):,}")
    print(f"  CRS:             {gdf.crs}")
    print(f"  Columns:         {list(gdf.columns)}")

    # Reproject to WGS84 if needed
    epsg = gdf.crs.to_epsg() if gdf.crs else None
    if epsg != 4326:
        print(f"  Reprojecting EPSG:{epsg} -> EPSG:4326 (WGS84)...")
        gdf = gdf.to_crs(epsg=4326)

    # Drop null geometries
    before = len(gdf)
    gdf = gdf[gdf.geometry.notnull() & gdf.geometry.is_valid]
    dropped = before - len(gdf)
    if dropped:
        print(f"  Dropped {dropped:,} null/invalid geometries")

    print(f"  Saving GeoJSON: {GEOJSON_OUT.name}")
    print("  (Writing may take a minute for large files...)")
    gdf.to_file(str(GEOJSON_OUT), driver="GeoJSON")

    size_mb = GEOJSON_OUT.stat().st_size / 1_048_576
    print(f"\n  [OK] Done. Output: {GEOJSON_OUT.name} ({size_mb:.1f} MB)")
    print(f"  [OK] {len(gdf):,} freehold polygon centroids ready for Script 02")


def main():
    print("\n=== Script 01: Download & Convert INSPIRE Polygons ===\n")

    if GEOJSON_OUT.exists():
        size_mb = GEOJSON_OUT.stat().st_size / 1_048_576
        print(f"[OK] GeoJSON already exists: {GEOJSON_OUT.name} ({size_mb:.1f} MB)")
        print("  Delete it and re-run to re-process.")
        print("\n  -> Run Script 02 next: python scripts/02_parse_polygons.py")
        return

    gml = find_gml()
    if gml:
        print(f"  Found existing GML: {gml.name}")
        convert_gml_to_geojson(gml)
        return

    zip_path = find_zip()
    if zip_path:
        print(f"  Found zip: {zip_path.name}")
        gml = extract_zip(zip_path)
        if not gml:
            print("ERROR: No GML file found inside zip. Check the zip contents.")
            sys.exit(1)
        convert_gml_to_geojson(gml)
        return

    # Nothing found -- show manual download instructions
    print(DOWNLOAD_INSTRUCTIONS)


if __name__ == "__main__":
    main()
