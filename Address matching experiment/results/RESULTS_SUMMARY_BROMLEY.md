# INSPIRE Polygon Centroid Experiment -- Results Summary (Bromley)

**Date:** 2026-03-11
**Test area:** Bromley, South East London (LA: E09000006)
**Transactions analysed:** 167
**Ground truth:** Nominatim (OpenStreetMap geocoder)
**Decision:** NO-GO

---

## Error Comparison

| Metric | Postcode Centroid | INSPIRE Polygon Centroid | Improvement |
|--------|:-----------------:|:------------------------:|:-----------:|
| Mean error (m) | 122.9m | 56.1m | 66.9m (2.2x) |
| Median error (m) | 46.0m | 53.4m | -- |
| Within 20m | 7% | 28% | -- |
| Within 50m | 55% | 47% | -- |
| Within 100m | 80% | 82% | -- |

INSPIRE beats postcode centroid in **51%** of transactions.

---

## Comparable Ranking Quality

Spearman rank correlation vs Nominatim ground truth:

| Method | Mean Spearman rho | Interpretation |
|--------|:--------------:|----------------|
| Postcode centroid | 0.9920 | Strong correlation with ground truth |
| INSPIRE centroid | 0.9994 | Strong correlation with ground truth |

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

## Recommendation: NO-GO

### Reason for NO-GO:

INSPIRE polygon centroid does not provide sufficient improvement over postcode centroid for this dataset. Further investigation needed.





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
