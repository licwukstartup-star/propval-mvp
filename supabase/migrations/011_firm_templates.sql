-- Firm-level report templates (Category A boilerplate)
-- Phase 1: single firm, single surveyor — keyed by surveyor_id
-- Future: migrate to firm_id when multi-tenancy is added

CREATE TABLE firm_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    surveyor_id     UUID NOT NULL,                  -- owner (auth.uid())

    -- Section boilerplate texts (RICS report structure)
    instructions        TEXT DEFAULT '',   -- 1.1 Instructions
    purpose             TEXT DEFAULT '',   -- 1.3 Purpose of Valuation
    responsibility      TEXT DEFAULT '',   -- 1.9 Responsibility
    disclosure          TEXT DEFAULT '',   -- 1.10 Disclosure
    pi_insurance        TEXT DEFAULT '',   -- 1.11 PI Insurance
    expertise           TEXT DEFAULT '',   -- 1.12 Expertise statement
    inspection          TEXT DEFAULT '',   -- 1.13 Inspection boilerplate
    environmental       TEXT DEFAULT '',   -- 2.9 Environmental Matters
    asbestos            TEXT DEFAULT '',   -- 2.15 Asbestos disclaimer
    fire_risk           TEXT DEFAULT '',   -- 2.18 Fire Risk & EWS1
    methodology         TEXT DEFAULT '',   -- 4.1 Valuation Methodology
    general_comments    TEXT DEFAULT '',   -- 4.6 General Comments

    -- Firm identity
    firm_name           TEXT DEFAULT '',
    firm_address        TEXT DEFAULT '',
    firm_rics_number    TEXT DEFAULT '',

    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- One template per surveyor (Phase 1)
CREATE UNIQUE INDEX idx_firm_templates_surveyor ON firm_templates(surveyor_id);
CREATE INDEX idx_firm_templates_updated ON firm_templates(updated_at DESC);

-- RLS: surveyors can only access their own template
ALTER TABLE firm_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Surveyors manage own firm template"
    ON firm_templates FOR ALL
    USING (surveyor_id = auth.uid());

-- Auto-update updated_at trigger (reuse pattern from cases)
CREATE OR REPLACE FUNCTION update_firm_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_firm_templates_updated_at
    BEFORE UPDATE ON firm_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_firm_templates_updated_at();
