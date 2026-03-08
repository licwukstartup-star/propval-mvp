-- Phase 1 completion: case sequence, issued status, immutability, valuation_basis

-- 1. Add 'issued' to allowed statuses
ALTER TABLE cases DROP CONSTRAINT IF EXISTS chk_case_status;
ALTER TABLE cases ADD CONSTRAINT chk_case_status
    CHECK (status IN ('draft', 'in_progress', 'complete', 'issued', 'archived'));

-- 2. Add case_sequence (auto-increment per UPRN)
ALTER TABLE cases ADD COLUMN IF NOT EXISTS case_sequence INTEGER;

-- 3. Add valuation_basis (market_value, market_rent, etc.)
ALTER TABLE cases ADD COLUMN IF NOT EXISTS valuation_basis TEXT;

-- 4. Add firm_reference (firm's internal file number)
ALTER TABLE cases ADD COLUMN IF NOT EXISTS firm_reference TEXT;

-- 5. Add finalised_at (locked timestamp when issued)
ALTER TABLE cases ADD COLUMN IF NOT EXISTS finalised_at TIMESTAMPTZ;

-- 6. Backfill case_sequence for existing cases
-- Assigns sequence numbers ordered by created_at within each UPRN
WITH numbered AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY uprn ORDER BY created_at) AS seq
    FROM cases
    WHERE uprn IS NOT NULL
)
UPDATE cases SET case_sequence = numbered.seq
FROM numbered WHERE cases.id = numbered.id;

-- For cases without UPRN, assign sequence 1
UPDATE cases SET case_sequence = 1 WHERE case_sequence IS NULL;

-- 7. Index for case sequence lookups
CREATE INDEX IF NOT EXISTS idx_cases_uprn_seq ON cases(uprn, case_sequence);
