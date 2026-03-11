# Experiment: INSPIRE Polygon Centroid vs Postcode Centroid

## ⚠️ IMPORTANT — ISOLATION RULES

**THIS IS A STANDALONE EXPERIMENT. DO NOT integrate into the PropVal product.**

- Do NOT modify any files in the propval-mvp codebase
- Do NOT import from or reference any propval-mvp modules
- Do NOT create branches, PRs, or commits in the propval-mvp repo
- All code, data, and output files must be saved ONLY to:
  `C:\Users\licww\Desktop\propval-mvp\Address matching experiment\`
- This folder is outside the product codebase — treat it as a disposable sandbox
- If the experiment succeeds, a separate decision will be made about if/how to integrate

## Problem

PropVal's comparable search engine currently geocodes properties using **postcode centroids** (from postcodes.io). In areas where a postcode covers a large geographic extent, the centroid can be **100–300m+ off target**. This degrades the distance-based comparable ranking — two properties 50m apart on the same street may appear equidistant from a subject property 250m away because they share the same postcode centroid.

## Hypothesis

By using **HMLR INSPIRE Index Polygon** data (free, OGL-licensed freehold boundary shapes), we can compute a **polygon centroid** for each freehold title. This polygon centroid will be significantly more accurate than the postcode centroid, producing better distance calculations for comparable ranking.

## What INSPIRE Index Polygons Are

- Free open dataset from HM Land Registry
- Contains freehold title boundary polygons for all registered freehold land in England & Wales
- Published as GML files, one per local authority, updated monthly
- Each polygon has a unique `INSPIRE ID` linked to a registered title
- Coordinates in British National Grid (EPSG:27700) — must reproject to WGS84 (EPSG:4326)
- Download from: `https://use-land-property-data.service.gov.uk/datasets/inspire/download`
- Licensed under OGL — free for commercial use with attribution
- **Key limitation:** freehold only — no leasehold polygons (but the freehold building footprint still gives you the correct location for leasehold flats within it)

## Experiment Design

### Step 1: Download INSPIRE Data

Download the GML file for **one London borough** (suggest Hackney or Tower Hamlets — areas we've tested valuations in before).

```bash
# Download from HMLR — select the local authority from the dropdown
# File will be a .zip containing Land_Registry_Cadastral_Parcels.gml
# Convert GML to GeoJSON with coordinate reprojection:
ogr2ogr -f "GeoJSON" inspire_hackney.geojson \
  Land_Registry_Cadastral_Parcels.gml \
  -s_srs EPSG:27700 -t_srs EPSG:4326
```

Requires: `gdal` (`pip install gdal` or `apt install gdal-bin`)

### Step 2: Parse Polygons and Compute Centroids

```python
import json
from shapely.geometry import shape

with open("inspire_hackney.geojson") as f:
    data = json.load(f)

polygon_centroids = {}
for feature in data["features"]:
    inspire_id = feature["properties"].get("INSPIREID") or feature["properties"].get("inspireid")
    geom = shape(feature["geometry"])
    centroid = geom.centroid
    polygon_centroids[inspire_id] = {
        "lat": centroid.y,
        "lng": centroid.x,
        "area_sqm": geom.area,  # rough, fine for comparison
    }

print(f"Loaded {len(polygon_centroids)} freehold polygon centroids")
```

### Step 3: Get Postcode Centroids for Comparison

For a sample of postcodes in the area, get centroids from postcodes.io:

```python
import requests

def get_postcode_centroid(postcode: str) -> dict:
    r = requests.get(f"https://api.postcodes.io/postcodes/{postcode.replace(' ', '')}")
    if r.status_code == 200:
        result = r.json()["result"]
        return {"lat": result["latitude"], "lng": result["longitude"]}
    return None
```

### Step 4: Get PPD Transactions via SPARQL

Query HMLR for recent transactions in the target postcode area:

```python
SPARQL_ENDPOINT = "http://landregistry.data.gov.uk/landregistry/query"

SPARQL_QUERY = """
PREFIX lrppi: <http://landregistry.data.gov.uk/def/ppi/>
PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT ?paon ?saon ?street ?postcode ?amount ?date ?propertyType
WHERE {
  ?txn lrppi:propertyAddress ?addr ;
       lrppi:pricePaid ?amount ;
       lrppi:transactionDate ?date .
  ?addr lrcommon:postcode "E8 1LA" ;
        lrcommon:street ?street .
  OPTIONAL { ?addr lrcommon:paon ?paon }
  OPTIONAL { ?addr lrcommon:saon ?saon }
  ?txn lrppi:propertyType/skos:prefLabel ?propertyType .
  FILTER (?date >= "2022-01-01"^^xsd:date)
}
ORDER BY DESC(?date)
LIMIT 50
"""
# Run for multiple postcodes in the test area
```

### Step 5: Spatial Matching — Link Transactions to Polygons

This is the key challenge. INSPIRE polygons don't carry addresses. Matching options:

**Option A — Point-in-polygon via postcodes.io + OS Places:**
1. For each PPD transaction, get its UPRN via OS Places API (postcode + address lookup)
2. Use the UPRN coordinates (from OS Places) to find which INSPIRE polygon contains that point
3. Use the polygon centroid instead of the postcode centroid

**Option B — Spatial proximity without UPRN:**
1. Get the postcode centroid as a starting point
2. Find all INSPIRE polygons within ~200m of that centroid
3. Filter by polygon size (residential building footprints are typically 50–200 sqm)
4. For streets with multiple properties, use the polygon ordering along the street axis

**Option C (simplest for this experiment):**
1. Use OS Places API to get the precise coordinate for each transaction address
2. Find the INSPIRE polygon that contains that coordinate (point-in-polygon test)
3. Compare: OS Places coordinate vs polygon centroid vs postcode centroid
4. This proves the concept even if the production matching would differ

Recommend **Option C** for the experiment as it's the cleanest test.

### Step 6: Measure the Improvement

For each transaction:

```python
from math import radians, sin, cos, sqrt, atan2

def haversine_m(lat1, lon1, lat2, lon2):
    R = 6_371_000
    φ1, φ2 = radians(lat1), radians(lat2)
    Δφ = radians(lat2 - lat1)
    Δλ = radians(lon2 - lon1)
    a = sin(Δφ/2)**2 + cos(φ1)*cos(φ2)*sin(Δλ/2)**2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))

# For each transaction, compute:
# error_postcode = haversine(postcode_centroid, os_places_precise_coord)
# error_polygon  = haversine(polygon_centroid, os_places_precise_coord)
# improvement    = error_postcode - error_polygon
```

### Step 7: Test Impact on Comparable Ranking

Pick a subject property. Rank the 10 nearest comparables by distance using:
- (a) postcode centroid coordinates
- (b) polygon centroid coordinates
- (c) OS Places precise coordinates (ground truth)

Compare how rankings (a) and (b) differ from ground truth (c). Report Spearman rank correlation or simple rank displacement.

## Expected Outcome

- Postcode centroid error: **80–300m** (varies hugely by postcode density)
- Polygon centroid error: **5–15m** (offset from building centre of mass to actual entrance/address point)
- Improvement factor: **10–30x** more accurate positioning
- Comparable ranking: significantly fewer rank inversions with polygon centroids

## What Success Looks Like

If the experiment shows polygon centroids are consistently within 20m of OS Places coordinates (vs 100m+ for postcode centroids), we integrate this into PropVal's data pipeline:

1. Pre-process INSPIRE GML files for all London boroughs → store polygon centroids in Supabase
2. During comparable search, spatial join PPD transactions to INSPIRE polygons
3. Use polygon centroid for distance calculation instead of postcode centroid
4. Fall back to postcode centroid only when no INSPIRE polygon match exists (leasehold-only titles, unregistered land)

## Dependencies

```
pip install geopandas shapely requests pyproj gdal
```

- OS Data Hub API key (free tier, 25k calls/month) — for OS Places lookups
- postcodes.io — no key needed
- HMLR SPARQL — no key needed
- HMLR INSPIRE download — no login needed

## Licensing Notes

INSPIRE Index Polygons are OGL. Attribution required:
> "This information is subject to Crown copyright and database rights [2026] and is reproduced with the permission of HM Land Registry. The polygons (including the associated geometry, namely x, y co-ordinates) © Crown copyright and database rights [2026] Ordnance Survey AC0000807064."

## Output

Save ALL files to: `C:\Users\licww\Desktop\propval-mvp\Address matching experiment\`

Folder structure:
```
Address matching experiment/
├── EXPERIMENT_INSPIRE_POLYGON_CENTROID.md   ← this brief
├── data/
│   ├── inspire_raw/                         ← downloaded GML + converted GeoJSON
│   ├── ppd_transactions.json                ← SPARQL query results
│   └── postcode_centroids.json              ← postcodes.io results
├── scripts/
│   ├── 01_download_inspire.py               ← download + convert GML
│   ├── 02_parse_polygons.py                 ← extract centroids from GeoJSON
│   ├── 03_fetch_ppd.py                      ← SPARQL query for transactions
│   ├── 04_match_and_compare.py              ← spatial matching + error measurement
│   └── 05_ranking_test.py                   ← comparable ranking comparison
├── results/
│   ├── error_comparison_table.csv           ← per-transaction centroid errors
│   ├── error_distribution.png               ← histogram chart
│   ├── ranking_comparison.csv               ← side-by-side rank test
│   └── RESULTS_SUMMARY.md                   ← findings + go/no-go recommendation
└── requirements.txt
```

**Do NOT save anything into the propval-mvp source tree.**

Results summary should include:
- Table: per-transaction comparison (postcode centroid error vs polygon centroid error)
- Chart: error distribution histogram
- Comparable ranking test: side-by-side rank comparison for 2–3 subject properties
- Recommendation: go/no-go for integration into PropVal pipeline (decision only, no code changes)
