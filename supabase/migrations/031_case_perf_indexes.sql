-- Performance indexes for case loading and listing queries.
-- These composite indexes cover the most common query patterns and avoid
-- sequential scans as the cases / case_comps tables grow.

-- Case list: WHERE surveyor_id = X ORDER BY updated_at DESC
CREATE INDEX IF NOT EXISTS idx_cases_surveyor_updated
  ON cases(surveyor_id, updated_at DESC);

-- Active comps for a case (filtered partial index)
CREATE INDEX IF NOT EXISTS idx_case_comps_case_active
  ON case_comps(case_id) WHERE unadopted_at IS NULL;

-- Case sequence lookup: WHERE uprn = X ORDER BY case_sequence DESC LIMIT 1
CREATE INDEX IF NOT EXISTS idx_cases_uprn_seq
  ON cases(uprn, case_sequence DESC);

-- ============================================================
-- Add enrichment columns to property_snapshots
-- These were computed during search but never persisted,
-- causing missing H.RM / IMD / c.AGE on saved-case reload.
-- ============================================================
ALTER TABLE property_snapshots
  ADD COLUMN IF NOT EXISTS imd_decile              INTEGER,
  ADD COLUMN IF NOT EXISTS construction_age_best   INTEGER;
