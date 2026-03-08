-- Mandate S2.4: Soft delete for cases (audit compliance)
-- Mandate S6.1: updated_at on all tables

-- Soft delete column
ALTER TABLE cases ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_cases_not_deleted ON cases(is_deleted) WHERE is_deleted = false;

-- Add updated_at to tables missing it
ALTER TABLE case_comparables ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE property_enrichment ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE epc_cache ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE epc_cache_status ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE property_enrichment_history ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
-- outward_code_adjacency is reference data, skip updated_at

-- Update cases RLS to exclude soft-deleted
DROP POLICY IF EXISTS "Surveyors see own cases" ON cases;
CREATE POLICY "Surveyors see own cases"
    ON cases FOR ALL
    USING (surveyor_id = auth.uid() AND is_deleted = false);
