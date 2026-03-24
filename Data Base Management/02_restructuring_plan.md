# PropVal Database Restructuring Plan

## Context

PropVal's database has grown organically across 29 migrations, resulting in overlapping tables, a denormalised `transactions` table mixing PPD+EPC+coords+age, and 3 local SQLite files that won't scale to 20+ valuers. This plan restructures the bulk data layer into clean, normalised tables with independent refresh lifecycles, adds PostGIS spatial support, and eliminates local file dependencies.

---

## Target Architecture

```
Layer 1: Spatial Reference (NEW — replaces local SQLite)
  ├── uprn_coordinates        PostGIS points     ~4M London UPRNs     quarterly
  └── title_boundaries        PostGIS polygons   DEFERRED (space risk)

Layer 2: Source Evidence (normalised — one table per source, independent lifecycle)
  ├── ppd_transactions        PPD only           HMLR                  monthly
  ├── epc_certificates        EPC only (KEEP)    DLUHC                 quarterly
  ├── registered_leases       Leases (KEEP)      HMLR                  quarterly
  └── construction_age        PropVal derived     Own pipeline          on demand

Layer 3: Query Interface (zero storage)
  └── VIEW `transactions`     JOINs Layer 1 + 2 via UPRN (replaces old table)

Layer 4: Application (unchanged)
```

---

## Risk Audit Findings & Mitigations

### CRITICAL RISKS

#### 1. `title_boundaries` could exceed disk — DEFERRED
- INSPIRE polygons in PostGIS could be 2.5-4GB (not 800MB as estimated)
- SQLite stores blobs efficiently; PostGIS adds WKB overhead + GiST index
- **Decision: DO NOT load `title_boundaries` in this migration.** Keep INSPIRE on local SQLite for now. Migrate in a future phase after confirming space or upgrading disk.

#### 2. `unmatched_transactions` is actively used — MUST KEEP
- `property.py` queries BOTH `transactions` AND `unmatched_transactions` for sale history
- Dropping it would lose sale history for properties without EPC matches
- **Decision: Merge `unmatched_transactions` rows into `ppd_transactions`** (with NULL UPRN). One table for all PPD records, matched or not.

#### 3. Rename instead of drop — Zero code changes for queries
- Backend has 15+ hardcoded `.from_("transactions")` calls
- **Decision: Rename old `transactions` to `transactions_legacy`. Create a VIEW named `transactions`** over the normalised tables. Backend code doesn't change at all — the VIEW is transparent.
- Same for `unmatched_transactions` — merged into `ppd_transactions`, no separate table needed.

#### 4. NULL UPRN records must keep coordinates
- Some PPD records have coords from geocoding but NULL UPRN
- In normalised structure, `uprn_coordinates` JOIN would lose these coords
- **Decision: Keep `lat`, `lon`, `coord_source` columns on `ppd_transactions`** for non-UPRN geocoded records. VIEW uses `COALESCE(uprn_coords.lat, ppd.lat)`.

#### 5. Column names must match exactly
- `_SPINE_SELECT` expects 26 specific column names (e.g. `epc_property_type`, not `property_type`)
- `_spine_to_ppd_format()` maps these to legacy format
- **Decision: VIEW aliases every column to match current names exactly.** Test with `_spine_to_ppd_format()` output comparison.

### HIGH RISKS

#### 6. WAL growth during bulk inserts
- 4M INSERT rows could generate 600MB+ WAL, counted toward 8GB disk
- **Mitigation:** Create tables WITHOUT indexes → bulk load → CREATE INDEX after. Use smaller batches (2k rows, 2s pause). Monitor disk with `SELECT pg_database_size(current_database())` between loads.

#### 7. VIEW performance through PostgREST
- PostgREST may not push filter predicates efficiently through multi-table JOINs
- **Mitigation:** Benchmark all 9 query patterns in `ppd_cache.py` against the VIEW before switching. If too slow, fall back to materialised view or keep denormalised table.

#### 8. FK constraints block table drops
- `case_comparables.transaction_id` FK → `comparable_transactions(id)`
- Must drop FK or dependent table first
- **Mitigation:** Drop `case_comparables` before `comparable_transactions`. Check ALL FK dependencies with `information_schema.referential_constraints` before each drop.

### MEDIUM RISKS

#### 9. `ppd_cache.py` still has on-demand PPD download logic
- Downloads PPD CSV and inserts into `price_paid_cache`
- If `price_paid_cache` is dropped, this code path errors
- **Mitigation:** Trace all INSERT/UPSERT paths in `ppd_cache.py`. Redirect to `ppd_transactions` or disable.

#### 10. DuckDB fallback may mask issues
- `local_property_db.py` may still be active, bypassing Supabase queries
- **Mitigation:** Confirm DuckDB is disabled/absent before testing migration.

---

## Revised Space Budget

**Important:** Renaming tables (best practice) does NOT free space immediately. Space is only freed when tables are actually DROPped in Phase 4.

### During Migration (Peak)
| Action | Size Change | Running Total |
|--------|------------|---------------|
| Starting point | | ~5.2GB |
| Rename 7 legacy tables (no space change) | 0 | ~5.2GB |
| Add `ppd_transactions` (matched + unmatched) | +1.5GB | ~6.7GB |
| Add `construction_age` | +50MB | ~6.75GB |
| Add `uprn_coordinates` (4M PostGIS points) | +600MB | ~7.35GB |
| Create indexes on new tables | +200MB | ~7.55GB |
| WAL overhead (temporary) | +500MB | **~8.0GB PEAK** |
| **Peak** | | **~8.0GB** ⚠️ |

### ⚠️ RISK: Peak is at the 8GB limit
The rename-not-drop approach means legacy tables still occupy space during migration. This is tight.

**Decision:** DROP the 3 truly unused tables (zero code refs) immediately → frees ~300MB. Rename the 4 cache tables (still referenced in code). Peak becomes ~7.7GB — safe margin.

### After Phase 4 Cleanup (Final)
| Action | Size Change |
|--------|------------|
| Drop 7 deprecated tables (2 weeks) | -1GB |
| Drop transactions_legacy + unmatched_transactions (4 weeks) | -2.7GB |
| WAL settles | -500MB |
| **Final total** | **~3.5-4GB** |

**title_boundaries DEFERRED** — not loaded in this migration.

---

## Best Practice Compliance

| Principle | Status | Notes |
|-----------|--------|-------|
| **Normalisation (3NF)** | PASS | Each table = one source, one lifecycle. VIEW restores normalised query without denormalisation |
| **Blue-Green Migration** | PASS | Rename + VIEW pattern = zero-downtime, instant rollback |
| **Backup Before Migration** | PASS | Manual Supabase backup in pre-checklist |
| **Index After Bulk Load** | PASS | Avoids index maintenance overhead during inserts |
| **Source-Aligned ETL** | PASS | Each table has documented source, script, refresh cycle |
| **Capacity Planning** | PASS | title_boundaries deferred, WAL budgeted, disk monitored between steps |
| **Soft References (no FK)** | ACCEPTED | FKs on bulk-loaded reference tables block truncate-reload. Application-enforced JOINs are standard for data warehouse patterns |
| **Rename Before Drop** | MUST FIX | Legacy tables should be renamed to `_deprecated_*` first, not dropped immediately. Drop after 2 weeks confirmed unused |
| **Performance SLA** | MUST ADD | Define acceptance criteria: no VIEW query >2x slower than current table query |
| **Checksum Validation** | MUST ADD | `SUM(price)`, `COUNT(*)`, `COUNT(*) WHERE lat IS NULL` before/after comparison |
| **Post-Migration Monitoring** | MUST ADD | Monitor query latency 48h post-deploy, alert on >5s queries |
| **Schema Documentation** | MUST ADD | Update ERD, migration comments explaining why restructure was done |
| **epc_certificates indexes** | MUST VERIFY | VIEW JOINs on `epc_certificates.uprn` — confirm index exists, or CREATE one |

---

## Pre-Migration Checklist

- [ ] **Manual Supabase backup** via dashboard (Database > Backups)
- [ ] **Check all FK dependencies** for tables being dropped
- [ ] **Confirm DuckDB fallback is disabled** in production
- [ ] **Search entire codebase** for every table name being dropped (not just backend — also scripts, tests, frontend)
- [ ] **Schedule maintenance window** — run during off-hours, notify any valuers
- [ ] **Verify PostGIS available** — `SELECT PostGIS_Version()` on Supabase
- [ ] **Verify `epc_certificates` has index on `uprn`** — required for VIEW JOIN performance
- [ ] **Record baseline query timings** — run all 9 `_query_*_sync()` patterns, record latency
- [ ] **Record baseline checksums** — `SELECT COUNT(*), SUM(price) FROM transactions` + `COUNT(*) WHERE lat IS NULL`

---

## Phase 1: Migration 029 — PostGIS + New Tables + VIEW

### 1a. Enable PostGIS
```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

### 1b. `uprn_coordinates`
```sql
CREATE TABLE uprn_coordinates (
    uprn    TEXT PRIMARY KEY,
    geom    GEOMETRY(Point, 4326) NOT NULL
);
-- Index created AFTER bulk load (Phase 2)

ALTER TABLE uprn_coordinates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read UPRN coordinates"
    ON uprn_coordinates FOR SELECT
    USING (auth.role() = 'authenticated');
```

### 1c. `ppd_transactions` — All PPD records (matched + unmatched)
```sql
CREATE TABLE ppd_transactions (
    transaction_id  TEXT PRIMARY KEY,
    price           INTEGER NOT NULL,
    date_of_transfer DATE NOT NULL,
    postcode        TEXT,
    outward_code    TEXT,
    saon            TEXT,
    paon            TEXT,
    street          TEXT,
    district        TEXT,
    ppd_type        CHAR(1),
    duration        CHAR(1),
    old_new         CHAR(1),
    ppd_category    CHAR(1),
    uprn            TEXT,
    lmk_key         TEXT,
    lat             DOUBLE PRECISION,
    lon             DOUBLE PRECISION,
    coord_source    TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
-- Indexes created AFTER bulk load (Phase 2)

ALTER TABLE ppd_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read PPD transactions"
    ON ppd_transactions FOR SELECT
    USING (auth.role() = 'authenticated');
```

Note: `lat`, `lon`, `coord_source` kept on PPD table for records geocoded without UPRN. `lmk_key` kept for construction_age JOIN.

### 1d. `construction_age`
```sql
CREATE TABLE construction_age (
    lmk_key     TEXT PRIMARY KEY,
    age_best    INTEGER,
    age_source  TEXT
);

ALTER TABLE construction_age ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read construction age"
    ON construction_age FOR SELECT
    USING (auth.role() = 'authenticated');
```

### 1e. Rename old table + create VIEW
```sql
-- Rename old denormalised table (safety net — kept for 4 weeks)
ALTER TABLE transactions RENAME TO transactions_legacy;

-- Create VIEW with EXACT same column names as old table
CREATE VIEW transactions AS
SELECT
    t.transaction_id,
    t.price,
    t.date_of_transfer,
    t.postcode,
    t.outward_code,
    t.saon,
    t.paon,
    t.street,
    t.district,
    t.ppd_type,
    t.duration,
    t.old_new,
    t.ppd_category,
    t.uprn,
    t.lmk_key,
    e.property_type   AS epc_property_type,
    e.built_form      AS epc_built_form,
    e.floor_area_sqm,
    e.habitable_rooms,
    e.energy_rating,
    e.energy_score,
    e.construction_age_band,
    ca.age_best,
    COALESCE(ST_Y(c.geom), t.lat) AS lat,
    COALESCE(ST_X(c.geom), t.lon) AS lon,
    t.coord_source
FROM ppd_transactions t
LEFT JOIN epc_certificates e ON t.uprn = e.uprn
LEFT JOIN construction_age ca ON t.lmk_key = ca.lmk_key
LEFT JOIN uprn_coordinates c ON t.uprn = c.uprn;
```

### 1f. INSPIRE RPC (for future use when title_boundaries is loaded)
```sql
CREATE FUNCTION nearest_title_boundary(p_lon FLOAT, p_lat FLOAT, p_max_dist FLOAT DEFAULT 350)
RETURNS TABLE (inspire_id TEXT, area_sqm NUMERIC, dist_m FLOAT)
LANGUAGE sql STABLE AS $$
    SELECT inspire_id, area_sqm,
           ST_Distance(
               centroid::geography,
               ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography
           ) AS dist_m
    FROM title_boundaries
    WHERE ST_DWithin(
        centroid::geography,
        ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography,
        p_max_dist
    )
    ORDER BY centroid <-> ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)
    LIMIT 1;
$$;
```

---

## Phase 2: Drop Unused Tables + Bulk Load

### Step 1: Drop unused + rename cache tables (free ~300MB)
```sql
-- 3 tables with ZERO code references — safe to DROP immediately
DROP TABLE IF EXISTS case_comparables;  -- FK dependency: drop before comparable_transactions
DROP TABLE IF EXISTS comparable_transactions;
DROP TABLE IF EXISTS outward_code_adjacency;

-- 4 cache tables still referenced in ppd_cache.py INSERT paths
-- Rename (not drop) — update code in Phase 3c, then drop in Phase 4
ALTER TABLE IF EXISTS price_paid_cache RENAME TO _deprecated_price_paid_cache;
ALTER TABLE IF EXISTS ppd_cache_status RENAME TO _deprecated_ppd_cache_status;
ALTER TABLE IF EXISTS epc_cache RENAME TO _deprecated_epc_cache;
ALTER TABLE IF EXISTS epc_cache_status RENAME TO _deprecated_epc_cache_status;
```

### Step 2: Load `ppd_transactions` (~20 mins)
- Source: `transactions_legacy` + `unmatched_transactions` (merge both)
- Script: `scripts/migrate_ppd_transactions.py`
- Copy PPD columns from `transactions_legacy` (matched records)
- Copy PPD columns from `unmatched_transactions` (unmatched records, NULL uprn/lmk_key)
- Batch: 2k rows, 2s pause
- Monitor: `SELECT pg_database_size(current_database())` after each batch

### Step 3: Load `construction_age` (~5 mins)
- Source: DuckDB `construction_age` table
- Script: `scripts/load_construction_age.py`
- Batch: 5k rows, 1s pause

### Step 4: Load `uprn_coordinates` (~45-60 mins)
- Source: OS Open UPRN CSV, filtered to London postcodes
- Script: `scripts/load_uprn_coordinates.py`
- Batch: 2k rows, 2s pause
- Transform: `ST_SetSRID(ST_MakePoint(lon, lat), 4326)`

### Step 5: Create indexes (after all loads complete)
```sql
-- uprn_coordinates
CREATE INDEX idx_uprn_coords_geom ON uprn_coordinates USING GIST (geom);

-- ppd_transactions
CREATE INDEX idx_ppd_outward_date ON ppd_transactions (outward_code, date_of_transfer DESC);
CREATE INDEX idx_ppd_postcode_date ON ppd_transactions (postcode, date_of_transfer DESC);
CREATE INDEX idx_ppd_uprn ON ppd_transactions (uprn) WHERE uprn IS NOT NULL;
CREATE INDEX idx_ppd_hard_deck ON ppd_transactions (outward_code, duration, ppd_type, date_of_transfer DESC);
CREATE INDEX idx_ppd_building ON ppd_transactions (outward_code, paon) WHERE ppd_type = 'F';
CREATE INDEX idx_ppd_street ON ppd_transactions (outward_code, street, date_of_transfer DESC);
CREATE INDEX idx_ppd_postcode_saon ON ppd_transactions (postcode, saon, paon);
CREATE INDEX idx_ppd_district ON ppd_transactions (district, date_of_transfer DESC);
```

### Step 6: ANALYZE all new tables
```sql
ANALYZE uprn_coordinates;
ANALYZE ppd_transactions;
ANALYZE construction_age;
```

### Step 7: Verify (Best Practice: Checksum + Spot Check + Performance)

**Data integrity (checksums):**
```sql
-- Must match pre-migration baselines
SELECT COUNT(*) AS row_count, SUM(price) AS price_sum FROM ppd_transactions;
SELECT COUNT(*) AS null_uprn FROM ppd_transactions WHERE uprn IS NULL;
SELECT COUNT(*) AS null_coords FROM ppd_transactions WHERE lat IS NULL AND uprn IS NULL;
```

**Functional checks:**
- Spot check: `SELECT * FROM transactions WHERE postcode = 'SW19 1AA' LIMIT 5` — compare VIEW output vs `transactions_legacy`
- Check `_SPINE_SELECT` columns all present and correctly aliased
- Check NULL-UPRN records still appear with their original lat/lon via COALESCE
- Check a known unmatched record (was in `unmatched_transactions`) appears in VIEW

**Performance SLA (no query >2x slower):**
- Run all 9 `_query_*_sync()` patterns against VIEW
- Compare latency to pre-migration baselines
- If any query >2x slower: investigate index coverage, consider adding indexes or reverting to `transactions_legacy`

---

## Phase 3: Backend Code Changes

### 3a. Replace UPRN Coords Service
**File:** `backend/services/uprn_coords.py` → Supabase query
**File:** `backend/routers/property.py` → `_uprn_coords()` queries `uprn_coordinates` table

### 3b. Remove SQLite startup loading
**File:** `backend/main.py` → Remove uprn_coords.db, inspire remains (title_boundaries deferred)

### 3c. Update `ppd_cache.py` on-demand logic
**File:** `backend/routers/ppd_cache.py` → Redirect any INSERT paths away from dropped `price_paid_cache`

### 3d. Update `get_sale_history()`
**File:** `backend/routers/property.py` → Remove `unmatched_transactions` loop, query `ppd_transactions` directly for PPD-only columns

### 3e. No changes needed for `_SPINE_SELECT` queries
The VIEW is named `transactions` — all existing `.from_("transactions")` calls work transparently.

---

## Phase 4: Cleanup (Staged Drops)

### After 2 weeks — drop deprecated cache tables
Only after confirming zero errors referencing these tables:
```sql
DROP TABLE IF EXISTS _deprecated_price_paid_cache;
DROP TABLE IF EXISTS _deprecated_ppd_cache_status;
DROP TABLE IF EXISTS _deprecated_epc_cache;
DROP TABLE IF EXISTS _deprecated_epc_cache_status;
```

### After 4 weeks — drop legacy spine
Only after confirming VIEW performs correctly in production:
```sql
DROP TABLE IF EXISTS transactions_legacy;
DROP TABLE IF EXISTS unmatched_transactions;
```

### Document the change
- Add migration 030 comment explaining what was dropped and why
- Update `Data Base Management/01_database_audit.md` with new table list
- Record final `pg_database_size()` after cleanup

---

## Phase 5: Refresh Scripts

| Table | Script | Source | Frequency |
|-------|--------|--------|-----------|
| `uprn_coordinates` | `scripts/refresh_uprn_coordinates.py` | OS Open UPRN CSV (London) | Quarterly |
| `ppd_transactions` | `scripts/refresh_ppd_transactions.py` | HMLR PPD CSV + matching pipeline | Monthly |
| `epc_certificates` | `scripts/refresh_epc_certificates.py` | EPC bulk CSV | Quarterly |
| `registered_leases` | `scripts/refresh_registered_leases.py` | HMLR Leases CSV | Quarterly |
| `construction_age` | `scripts/refresh_construction_age.py` | PropVal age pipeline | After EPC refresh |

Each script: truncate → batch insert (2k rows, 2s pause) → CREATE INDEX → ANALYZE.

---

## Deferred: title_boundaries (Future Phase)

INSPIRE polygon migration deferred due to space risk (could be 2.5-4GB in PostGIS). Will migrate when:
- Supabase disk upgraded, OR
- Space confirmed after cleanup settles, OR
- Centroid-only table tested (skip full polygon geometry, much smaller)

INSPIRE remains on local SQLite + KDTree until then. `nearest_title_boundary` RPC function already created, ready for when data is loaded.

---

## Files to Modify

| File | Changes |
|------|---------|
| `backend/services/uprn_coords.py` | Remove SQLite → Supabase query |
| `backend/main.py` | Remove uprn_coords.db startup loading |
| `backend/routers/property.py` | Update `_uprn_coords()`, `get_sale_history()`, `_lookup_age_best()` |
| `backend/routers/ppd_cache.py` | Redirect INSERT paths away from dropped cache tables |

**No changes needed** for: `ppd_cache.py` SELECT queries, `comparables.py`, `browse_sales()` — the VIEW named `transactions` handles these transparently.

---

## Verification Checklist

### Data Integrity
- [ ] Row count `ppd_transactions` = `transactions_legacy` + `unmatched_transactions`
- [ ] `SUM(price)` matches pre-migration baseline
- [ ] `COUNT(*) WHERE lat IS NULL` matches or improves (UPRN coords fill gaps)
- [ ] NULL-UPRN records retain original lat/lon via COALESCE

### Functional
- [ ] `SELECT * FROM transactions LIMIT 10` returns same columns as before (VIEW transparent)
- [ ] Comparable search for known postcode returns identical results
- [ ] Property search returns UPRN coordinates from Supabase (not SQLite)
- [ ] Sale history includes records that were previously in `unmatched_transactions`
- [ ] `_lookup_age_best()` returns correct age for known UPRN
- [ ] Backend starts without loading uprn_coords.db
- [ ] INSPIRE KDTree still works (deferred, not changed)

### Performance
- [ ] All 9 query patterns run within 2x of pre-migration baseline latency
- [ ] No 500 errors in production logs after deployment
- [ ] Monitor query latency for 48 hours post-deploy

### Infrastructure
- [ ] `SELECT pg_database_size(current_database())` < 6GB after migration settles
- [ ] WAL size returns to normal within 24 hours
- [ ] No CPU spikes above 80% during normal operation post-migration

---

## Time Estimate

| Phase | Duration |
|-------|----------|
| Pre-migration checks + backup | 15 mins |
| Phase 1: Migration DDL | 5 mins |
| Phase 2: Drops + bulk loads + indexes | ~1.5 hours |
| Phase 3: Backend changes | ~2 hours |
| Phase 4: 4-week observation period | — |
| Phase 5: Refresh scripts | ~1.5 hours |
| **Active work total** | **~5-6 hours** |
