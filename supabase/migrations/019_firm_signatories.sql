-- Firm signatory registry — staff details for report signing
-- Phase 1: keyed by surveyor_id (same pattern as firm_templates)

CREATE TABLE firm_signatories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    surveyor_id     UUID NOT NULL,                  -- owner (auth.uid())

    full_name           TEXT NOT NULL,
    rics_number         TEXT DEFAULT '',
    qualifications      TEXT DEFAULT '',             -- e.g. "MRICS", "FRICS"
    role_title          TEXT DEFAULT '',             -- e.g. "Director", "Senior Surveyor"
    email               TEXT DEFAULT '',
    phone               TEXT DEFAULT '',
    can_prepare         BOOLEAN DEFAULT true,
    can_countersign     BOOLEAN DEFAULT false,
    is_active           BOOLEAN DEFAULT true,

    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_firm_signatories_surveyor ON firm_signatories(surveyor_id);
CREATE INDEX idx_firm_signatories_active ON firm_signatories(surveyor_id, is_active);

-- RLS: surveyors can only access their own signatories
ALTER TABLE firm_signatories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Surveyors manage own signatories"
    ON firm_signatories FOR ALL
    USING (surveyor_id = auth.uid());

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_firm_signatories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_firm_signatories_updated_at
    BEFORE UPDATE ON firm_signatories
    FOR EACH ROW
    EXECUTE FUNCTION update_firm_signatories_updated_at();
