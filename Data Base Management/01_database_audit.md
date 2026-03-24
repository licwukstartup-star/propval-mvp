# PropVal Database Audit
**Date:** 2026-03-23

---

## Overview
- **Supabase tier:** Pro ($25/mo), 8GB disk, 5.17GB used, 2.83GB free
- **Total tables:** 28 (22 active + 6 legacy)
- **Migrations:** 29 files (001–028, with 028 duplicated)
- **Local SQLite databases:** 3 (not yet migrated)

---

## A. Actively Used Tables (22)

### Case Management (3 tables)
| Table | PK | Purpose | RLS |
|-------|-----|---------|-----|
| `cases` | UUID | Surveyor case files — type, status, UPRN, firm_id, JSONB blobs (property_snapshot, comparables, search_results, ui_state) | Firm-scoped |
| `case_comps` | UUID | Junction: case ↔ property_snapshot adoption, with tier/notes/citation_role | Firm-scoped |
| `property_snapshots` | UUID | Immutable property evidence records with provenance + lineage (based_on_id) | 3-tier (public/firm/admin) |

### Property Library (3 tables)
| Table | PK | Purpose | RLS |
|-------|-----|---------|-----|
| `properties` | uprn TEXT | Master UPRN record — address, postcode, lat/lon (postcodes.io), type, floor area | Read: all authenticated |
| `property_enrichment` | UUID | Cached API responses per UPRN per data_source (JSONB payload), UNIQUE(uprn, data_source) | Read: all authenticated |
| `property_enrichment_history` | UUID | Archived superseded enrichment payloads (audit trail) | Read: all authenticated |

### Spine Tables (5 tables) — Migration 027
| Table | PK | Purpose | RLS |
|-------|-----|---------|-----|
| `transactions` | transaction_id TEXT | Pre-matched PPD + EPC, denormalised with UPRN, coords, floor area, age | Read: all authenticated |
| `epc_certificates` | lmk_key TEXT | Full EPC dataset (~4.4M rows), property details + energy ratings | Read: all authenticated |
| `unmatched_transactions` | transaction_id TEXT | PPD records without EPC match (fallback) | Read: all authenticated |
| `registered_leases` | BIGINT identity | Lease term/expiry by UPRN | Read: all authenticated |
| `epc_addresses` | BIGINT identity | Lightweight autocomplete index (deduped latest EPC per address) | Read: all authenticated |

### Report Lifecycle (5 tables)
| Table | PK | Purpose | RLS |
|-------|-----|---------|-----|
| `report_copies` | UUID | Immutable versioned report drafts (TipTap HTML + JSON), UNIQUE(case_id, version) | Creator + firm |
| `report_templates` | UUID | ARTG template library (system/uploaded/custom), JSON schema | Creator + system |
| `review_requests` | UUID | Countersign workflow — requester, reviewer, status, UNIQUE(copy_id) | Requester + reviewer |
| `review_events` | UUID | Audit trail of review actions (submitted, approved, etc.) | Review participants |
| `qa_results` | UUID | AI QA findings per report copy (JSONB) | Run_by + firm |

### Firm & Multi-Tenancy (4 tables)
| Table | PK | Purpose | RLS |
|-------|-----|---------|-----|
| `firms` | UUID | Organisation identity (name, slug) | Members + admin |
| `firm_members` | UUID | User ↔ firm membership + role (admin/member), UNIQUE(firm_id, user_id) | Own firm members |
| `firm_templates` | UUID | RICS boilerplate sections + AI prompt overrides per surveyor, UNIQUE(surveyor_id) | Surveyor + firm |
| `firm_signatories` | UUID | Signatory register — name, RICS number, can_prepare/can_countersign | Surveyor only |

### Intelligence & AI (5 tables)
| Table | PK | Purpose | RLS |
|-------|-----|---------|-----|
| `news_articles` | UUID | RSS-aggregated market news (property/rics/macro), UNIQUE(url) | Read: all authenticated |
| `macro_indicators` | UUID | Economic indicators (base rate, CPI, HPI, GDP, gilt, unemployment), UNIQUE(indicator_key) | Read: all authenticated |
| `notifications` | UUID | In-app bell notifications for review workflow events | Own user only |
| `valuer_feedback` | UUID | AI vs valuer output capture (narrative_edit, comp_selection, value_adoption, qa_override) | Insert: service_role; Read: own + admin |
| `prompt_registry` | UUID | Versioned AI prompts with quality metrics (acceptance_rate, avg_edit_distance) | Read: authenticated; Write: admin |

### Usage Tracking (1 table)
| Table | PK | Purpose | RLS |
|-------|-----|---------|-----|
| `ai_usage_log` | (varies) | Token/cost tracking per AI call (Gemini, Groq, Cerebras, Claude) | Service role |

---

## B. Legacy Tables — Should Be Removed (6)

### Safe to Drop Immediately (never referenced in code)
| Table | Created In | Replaced By | Notes |
|-------|-----------|-------------|-------|
| `comparable_transactions` | 001 | `transactions` (027) | Old comparable cache, zero code references |
| `case_comparables` | 001 | `case_comps` (016) | Old junction table, zero code references |
| `outward_code_adjacency` | 001 | Nothing | Pre-computed adjacency, never queried |

### Deprecate After Spine Stabilises
| Table | Created In | Replaced By | Notes |
|-------|-----------|-------------|-------|
| `price_paid_cache` | (pre-001) | `transactions` (027) | Still referenced in comparables.py, ppd_cache.py |
| `ppd_cache_status` | (pre-001) | Spine import | Tracks PPD cache freshness, still referenced |
| `epc_cache` + `epc_cache_status` | 008 | `epc_certificates` (027) | Still referenced, deprecate together |

---

## C. Issues Identified

### 1. Schema Bloat
6 legacy tables consuming space and causing confusion. 3 can be dropped immediately.

### 2. Overloaded `cases` Table
Carries too many large JSONB columns:
- `property_data` (deprecated, nullable)
- `property_snapshot` (large blob)
- `comparables` (large blob)
- `search_results` (large blob)
- `ui_state` (UI preferences)
Every case load pulls all of these.

### 3. Coordinate Inconsistency
- `properties.lat/lon` → postcodes.io (~100m accuracy)
- `transactions.lat/lon` → OS Open UPRN (~1-5m accuracy)
- No column-level documentation of which source each is

### 4. Dual Migration 028
Two files both numbered 028 (AI flywheel + EPC autocomplete table). Could cause migration ordering issues.

### 5. `firm_signatories` Not Linked to `firm_id`
Uses `surveyor_id` only, unlike other firm-scoped tables. Won't scale when multiple valuers join a firm.

### 6. Shared Enrichment Writes
`properties` and `property_enrichment` are shared across all firms. Any firm's backend writes are visible to all. Could be a data quality concern at scale (but may be intentional for shared reference data).

---

## D. Local Data Not Yet in Supabase

| Data | Location | Records | Size | Notes |
|------|----------|---------|------|-------|
| **OS Open UPRN Coordinates** | `backend/data/uprn_coords.db` (SQLite) | 41.5M (all E&W), ~4M London | ~700MB London-only | No API available, bulk download only, quarterly refresh |
| **HMLR INSPIRE Polygons** | `backend/data/inspire_polygons.db` + `Research/.../inspire_centroids_london.json` | ~2M (London) | ~119MB centroids + polygon DB | Monthly refresh from HMLR, currently uses in-memory KDTree |
| **Registered Leases (local)** | `backend/data/leases.db` (SQLite) | Unknown | Unknown | Supabase table exists (027) — check if local is still used as fallback |

### Migration Decisions Made
- UPRN coords: **Separate `uprn_coordinates` table** with PostGIS `GEOMETRY(Point, 4326)`, London only (~4M rows, ~700MB)
- INSPIRE: **Separate `inspire_polygons` table** with PostGIS geometry columns (centroid POINT + boundary POLYGON)
- Both use GiST spatial indexes, replacing in-memory KDTree
- Leases: Already has Supabase table — just remove local fallback

---

## E. Data Source Map (Complete)

### Supabase (production-ready)
All 22 active tables above.

### Local Files (backend server only — must migrate)
3 SQLite databases listed in Section D.

### External APIs — Backend (20+ UK gov APIs)
EPC, Land Registry SPARQL, Land Registry PPD CSV, EA Flood (WMS + ArcGIS), postcodes.io, Nominatim, planning.data.gov.uk, Historic England NHLE, BGS GeoSure (6 layers), BGS Radon, Coal Authority, Natural England (SSSI/AONB/Ancient Woodland), Ofcom Broadband, Ofcom Mobile, UK HPI, Council Tax, GLA Planning (London). All cached to `property_enrichment` with 30-365 day TTLs.

### External APIs — Frontend Direct
postcodes.io, Overpass (OSM), EA Flood/Noise WMS, ESRI IMD 2019, Historic England NHLE, UK Police Crime, Google Maps Embed, map tile providers.

### AI Services
Google Gemini 2.0 Flash (primary), Groq llama-3.1-70b (fallback), Cerebras (fallback), Anthropic Claude 3.5 Sonnet (template extraction).

### Client-Side Storage
localStorage only: card-sizes, theme, cookie-consent.

---

## F. RPC Functions

| Function | Purpose |
|----------|---------|
| `autocomplete_by_postcode(pc TEXT)` | Fast EPC address autocomplete (5s timeout), queries epc_addresses → epc_certificates → epc_cache fallback |
| `get_user_firm_id()` | SECURITY DEFINER helper, returns calling user's firm_id, prevents RLS recursion |

## G. Triggers

| Trigger | Table | Action |
|---------|-------|--------|
| `trg_firm_templates_updated_at` | `firm_templates` | Sets `updated_at = NOW()` on UPDATE |
| `trg_firm_signatories_updated_at` | `firm_signatories` | Sets `updated_at = NOW()` on UPDATE |
