-- Saved cases — one per property search
CREATE TABLE cases (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    surveyor_id     UUID NOT NULL,                  -- auth.uid()
    title           TEXT NOT NULL,                   -- user-chosen label
    address         TEXT NOT NULL,
    postcode        TEXT,
    uprn            TEXT,

    -- Full property search result snapshot (JSON blob)
    property_data   JSONB NOT NULL,

    -- Adopted comparables snapshot (JSON array)
    comparables     JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Valuation parameters at time of save
    valuation_date  DATE,
    hpi_correlation NUMERIC DEFAULT 100,
    size_elasticity NUMERIC DEFAULT 0,

    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cases_surveyor ON cases(surveyor_id);
CREATE INDEX idx_cases_updated  ON cases(updated_at DESC);

-- RLS: surveyors can only access their own cases
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Surveyors see own cases"
    ON cases FOR ALL
    USING (surveyor_id = auth.uid());
