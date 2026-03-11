# INSPIRE Download Progress — All 33 London Boroughs

Started: 2026-03-11

| # | Slug | Status | Size | Notes |
|---|------|--------|------|-------|
| 1 | city_of_london | ✅ done | 0.9 MB | |
| 2 | barking_and_dagenham | ✅ done | 6.5 MB | |
| 3 | barnet | ✅ done | 12.8 MB | |
| 4 | bexley | ✅ done | 10.4 MB | |
| 5 | brent | ✅ done | 7.9 MB | |
| 6 | bromley | ✅ done | 16 MB | Downloaded manually earlier |
| 7 | camden | ✅ done | 3.8 MB | |
| 8 | croydon | ✅ done | 14 MB | Test download earlier |
| 9 | ealing | ✅ done | 10.0 MB | |
| 10 | enfield | ✅ done | 11.2 MB | |
| 11 | greenwich | ✅ done | 8.0 MB | |
| 12 | hackney | ✅ done | 3.9 MB | |
| 13 | hammersmith_and_fulham | ✅ done | 3.7 MB | |
| 14 | haringey | ✅ done | 6.3 MB | |
| 15 | harrow | ✅ done | 8.5 MB | |
| 16 | havering | ✅ done | 12.0 MB | |
| 17 | hillingdon | ✅ done | 12.8 MB | |
| 18 | hounslow | ✅ done | 8.9 MB | |
| 19 | islington | ✅ done | 3.4 MB | |
| 20 | kensington_and_chelsea | ✅ done | 2.8 MB | |
| 21 | kingston_upon_thames | ✅ done | 6.1 MB | |
| 22 | lambeth | ✅ done | 5.5 MB | |
| 23 | lewisham | ✅ done | 7.5 MB | |
| 24 | merton | ✅ done | 6.8 MB | |
| 25 | newham | ✅ done | 6.9 MB | |
| 26 | redbridge | ✅ done | 9.1 MB | |
| 27 | richmond_upon_thames | ✅ done | 7.7 MB | |
| 28 | southwark | ✅ done | 5.0 MB | |
| 29 | sutton | ✅ done | 7.7 MB | Downloaded manually earlier |
| 30 | tower_hamlets | ✅ done | 3.5 MB | |
| 31 | waltham_forest | ✅ done | 7.7 MB | |
| 32 | wandsworth | ✅ done | 7.0 MB | |
| 33 | westminster | ❌ failed | — | HMLR server redirect loop (30 redirects). Retry tomorrow. |

## Summary
- Total: 33 boroughs
- Downloaded: **32 / 33** (westminster pending)
- GeoJSON converted: **32 / 33**
- Centroids extracted: **32 / 33**
- Production file: `inspire_centroids_london.json` — **119.1 MB, 2,033,242 unique polygons**

## Next Steps
1. Retry Westminster: `py -3.11 scripts/00_batch_download_inspire.py --slug westminster`
2. Then re-run: `py -3.11 scripts/01_batch_convert_inspire.py && py -3.11 scripts/02_batch_extract_centroids.py`
3. Wire `inspire_centroids_london.json` into PropVal FastAPI backend

---

## Session Log

### 2026-03-11 — Session 1
- bromley: pre-existing (16 MB)
- sutton: pre-existing (7.7 MB)
- croydon: pre-existing test download (14 MB)

### 2026-03-11 — Session 2
Downloaded 29 boroughs in sequence (all OK except Westminster):
city_of_london (0.9 MB), barking_and_dagenham (6.5 MB), barnet (12.8 MB),
bexley (10.4 MB), brent (7.9 MB), camden (3.8 MB), ealing (10.0 MB),
enfield (11.2 MB), greenwich (8.0 MB), hackney (3.9 MB),
hammersmith_and_fulham (3.7 MB), haringey (6.3 MB), harrow (8.5 MB),
havering (12.0 MB), hillingdon (12.8 MB), hounslow (8.9 MB),
islington (3.4 MB), kensington_and_chelsea (2.8 MB), kingston_upon_thames (6.1 MB),
lambeth (5.5 MB), lewisham (7.5 MB), merton (6.8 MB), newham (6.9 MB),
redbridge (9.1 MB), richmond_upon_thames (7.7 MB), southwark (5.0 MB),
tower_hamlets (3.5 MB), waltham_forest (7.7 MB), wandsworth (7.0 MB)

westminster: FAILED — "Exceeded 30 redirects" (HMLR server issue, retry tomorrow)

Script 01 fix: updated to recognise plain slug-named zips (bromley.zip etc), not just GSS-prefixed (E09000006_bromley.zip)

Script 01 + 02 run completed:
- 30 boroughs converted to GeoJSON (0 failed)
- 32 boroughs centroid-extracted (incl. cached bromley + sutton)
- inspire_centroids_london.json: 119.1 MB, 2,033,242 unique polygons ✅
