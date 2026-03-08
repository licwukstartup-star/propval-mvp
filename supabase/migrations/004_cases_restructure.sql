-- Restructure cases table for Phase 1 architecture.
-- Cases now reference a UPRN (property) rather than storing a full data blob.
-- Cases stack under a UPRN — multiple cases per property are expected.

-- 1. Add new columns
ALTER TABLE cases ADD COLUMN IF NOT EXISTS case_type TEXT NOT NULL DEFAULT 'research';
ALTER TABLE cases ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE cases ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS property_snapshot JSONB;

-- 2. Migrate existing data: copy property_data into property_snapshot for existing rows
UPDATE cases SET property_snapshot = property_data WHERE property_data IS NOT NULL;

-- 3. Generate display_name for existing cases from title
UPDATE cases SET display_name = title WHERE display_name IS NULL AND title IS NOT NULL;

-- 4. Make property_data nullable (we'll stop writing it for new cases)
ALTER TABLE cases ALTER COLUMN property_data DROP NOT NULL;

-- 5. Add check constraints for case_type and status
ALTER TABLE cases ADD CONSTRAINT chk_case_type
    CHECK (case_type IN ('research', 'quotation', 'indicative', 'desktop', 'full_valuation'));

ALTER TABLE cases ADD CONSTRAINT chk_case_status
    CHECK (status IN ('draft', 'in_progress', 'complete', 'archived'));

-- 6. Index for UPRN lookups (find all cases for a property)
CREATE INDEX IF NOT EXISTS idx_cases_uprn ON cases(uprn);
CREATE INDEX IF NOT EXISTS idx_cases_type ON cases(case_type);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
