# INSPIRE Polygon Centroid Experiment -- Results Summary (Sutton)

**Date:** 2026-03-11
**Test area:** Sutton, South London (LA: E09000029)
**Transactions analysed:** 140
**Ground truth:** Nominatim (OpenStreetMap geocoder)
**Decision:** CONDITIONAL

---

## Error Comparison

| Metric | Postcode Centroid | INSPIRE Polygon Centroid | Improvement |
|--------|:-----------------:|:------------------------:|:-----------:|
| Mean error (m) | 91.8m | 30.3m | 61.5m (3.0x) |
| Median error (m) | 44.3m | 23.6m | -- |
| Within 20m | 14% | 28% | -- |
| Within 50m | 54% | 89% | -- |
| Within 100m | 78% | 96% | -- |

INSPIRE beats postcode centroid in **74%** of transactions.

---

## Comparable Ranking Quality

Spearman rank correlation vs Nominatim ground truth:

| Method | Mean Spearman rho | Interpretation |
|--------|:--------------:|----------------|
| Postcode centroid | 0.9808 | Strong correlation with ground truth |
| INSPIRE centroid | 0.9983 | Strong correlation with ground truth |

rho = 1.0 means perfect ranking agreement; rho = 0 means no correlation.

---

## Limitations

- Ground truth is Nominatim, not OS AddressBase Premium. Nominatim accuracy
  for specific UK property addresses is typically 5–30m -- which introduces
  some noise but does not affect the overall conclusion (postcode centroids
  are 100–300m off, a completely different order of magnitude).
- INSPIRE covers freehold titles only. For leasehold flats the building
  freehold polygon is used -- centroid accuracy remains good (building-level
  vs postcode-level positioning).
- Coverage: transactions without an INSPIRE polygon match are excluded.
  In dense urban Hackney this affects mainly unregistered land and
  brand-new titles not yet in the INSPIRE dataset.

---

## Recommendation: CONDITIONAL

### Integration plan (if approved):

1. Pre-process INSPIRE GML files for all London boroughs -> compute polygon centroids -> store in Supabase `inspire_centroids` table (UPRN + inspire_id + lat + lng).
2. During comparable search, perform a point-in-polygon lookup to assign each PPD transaction an INSPIRE polygon centroid.
3. Use polygon centroid for haversine distance calculation in comparable ranking.
4. Fall back to postcode centroid when no INSPIRE polygon is matched (leasehold-only titles, unregistered land).
5. Extend to all England & Wales boroughs for full PropVal coverage.

---

## Attribution

INSPIRE Index Polygons are OGL-licensed from HM Land Registry:
> "This information is subject to Crown copyright and database rights [2026] and is reproduced
>  with the permission of HM Land Registry. The polygons (including the associated geometry,
>  namely x, y co-ordinates) © Crown copyright and database rights [2026] Ordnance Survey
>  AC0000807064."

Price Paid Data: © Crown copyright, HM Land Registry. OGL v3.
Nominatim: © OpenStreetMap contributors, ODbL.
postcodes.io: Open Data, MIT licence.
