# Database Restructuring — Completed
**Date:** 2026-03-23

## What Changed

### New Tables Created
| Table | Records | Size | Source |
|-------|---------|------|--------|
| `ppd_transactions` | 1,237,337 | ~400MB + indexes | HMLR PPD (matched + unmatched merged) |
| `construction_age` | 4,436,405 | ~200MB | PropVal age pipeline (DuckDB) |
| `uprn_coordinates` | 5,957,125 | ~500MB + GiST index | OS Open UPRN (London bounding box) |

### Tables Removed
| Table | Reason |
|-------|--------|
| `transactions` | Renamed to `transactions_legacy`, then dropped (data in `ppd_transactions`) |
| `transactions_legacy` | Dropped after VIEW verified |
| `unmatched_transactions` | Merged into `ppd_transactions` |

### VIEW Created
`transactions` VIEW — JOINs `ppd_transactions` + `epc_certificates` (on lmk_key) + `construction_age` (on lmk_key) + `uprn_coordinates` (on uprn). Returns exact same 26 columns as old denormalised table. Backend code works unchanged.

### RPC Functions Created
- `lookup_uprn_coords(p_uprn TEXT)` — single UPRN → (lat, lon)
- `lookup_uprn_coords_batch(p_uprns TEXT[])` — batch UPRN → (uprn, lat, lon)

### PostGIS Enabled
Extension enabled for spatial coordinate storage and queries.

### Missing Indexes Fixed
`epc_certificates` was missing indexes on `postcode`, `outward_code`, `uprn`, `address`. Created — UPRN lookup went from 9.2s → 0.023s.

## Backend Code Changes
| File | Change |
|------|--------|
| `backend/services/uprn_coords.py` | Rewritten: SQLite → Supabase RPC |
| `backend/main.py` | Removed async SQLite loading, instant Supabase service init |
| `backend/routers/property.py` | `_lookup_age_best()` uses `construction_age` table; `_query_spine_sale_history_sync()` queries `ppd_transactions` directly; EPC autocomplete fallback uses `epc_certificates` |

## Verification Results
- Row count: 1,237,337 ✓ (matches transactions_legacy + unmatched_transactions)
- Sum(price): 974,658,720,583 ✓
- VIEW columns: all 26 match `_SPINE_SELECT` ✓
- VIEW performance: all queries < 1s ✓
- UPRN coords: lookup 0.023s, batch working ✓
- Database size: 5,883 MB (was 4,469 MB before restructure)

## Current Table List (Post-Restructure)

### Bulk Data Layer
| Table | Type | Records | Refresh |
|-------|------|---------|---------|
| `ppd_transactions` | TABLE | 1,237,337 | Monthly (HMLR PPD) |
| `epc_certificates` | TABLE | 4,427,405 | Quarterly (DLUHC) |
| `construction_age` | TABLE | 4,436,405 | After EPC refresh |
| `uprn_coordinates` | TABLE | 5,957,125 | Quarterly (OS) |
| `registered_leases` | TABLE | existing | Quarterly (HMLR) |
| `epc_addresses` | TABLE | existing | With EPC refresh |
| `transactions` | VIEW | — | Auto (JOINs above) |

### Application Layer (unchanged)
cases, case_comps, property_snapshots, properties, property_enrichment, property_enrichment_history, report_copies, report_templates, review_requests, review_events, qa_results, firms, firm_members, firm_templates, firm_signatories, news_articles, macro_indicators, notifications, valuer_feedback, prompt_registry, ai_usage_log

## Deferred
- `title_boundaries` (HMLR INSPIRE polygons) — deferred due to space risk (2.5-4GB in PostGIS). Remains on local SQLite + KDTree.
