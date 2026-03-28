-- ============================================================
-- Migration 032: Panel Configs
-- ============================================================
-- Panel theme system: thin config overlays that sit on top of the
-- base report template.  Each panel (VAS, Method, etc.) defines
-- extra sections, tighter field requirements, inline reminders,
-- QA rules, boilerplate overrides, and branding tweaks.
--
-- The base template is never mutated — panel config is merged at
-- render time (both frontend wizard and backend DOCX export).
-- Adding a new panel = one DB insert, zero code changes.
--
-- Rollback:
--   ALTER TABLE report_copies DROP COLUMN IF EXISTS panel_id;
--   ALTER TABLE cases DROP COLUMN IF EXISTS instruction_source;
--   ALTER TABLE cases DROP COLUMN IF EXISTS panel_id;
--   DROP TABLE IF EXISTS panel_configs;
-- ============================================================

-- 1. Panel configs table
CREATE TABLE panel_configs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT NOT NULL UNIQUE,       -- "vas", "method", "nationwide"
    name        TEXT NOT NULL,              -- "VAS Panel", "Method Panel"
    description TEXT,
    config      JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_panel_configs_slug ON panel_configs(slug);

-- RLS: all authenticated users can read active panels, admins can manage
ALTER TABLE panel_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated users can read active panels"
    ON panel_configs FOR SELECT
    USING (is_active = true);

CREATE POLICY "Admin can manage panels"
    ON panel_configs FOR ALL
    USING (
        (auth.jwt()->'user_metadata'->>'role') = 'admin'
    );

-- 2. Add panel_id and instruction_source to cases
ALTER TABLE cases ADD COLUMN IF NOT EXISTS panel_id UUID REFERENCES panel_configs(id);
ALTER TABLE cases ADD COLUMN IF NOT EXISTS instruction_source TEXT;

CREATE INDEX IF NOT EXISTS idx_cases_panel ON cases(panel_id);

-- 3. Add panel_id to report_copies (snapshot of active panel at copy time)
ALTER TABLE report_copies ADD COLUMN IF NOT EXISTS panel_id UUID REFERENCES panel_configs(id);

-- 4. Seed VAS and Method panel configs
INSERT INTO panel_configs (slug, name, description, config) VALUES
(
    'vas',
    'VAS Panel',
    'Valuation Assurance Scheme — additional executive summary, minimum 5 comps, ranking required',
    '{
        "version": "1.0",
        "extra_sections": [
            {
                "id": "panel_exec_summary",
                "type": "narrative",
                "title": "Executive Summary",
                "insert_after": "cover",
                "ai_section_key": "exec_summary",
                "panel_boilerplate": null
            }
        ],
        "hidden_sections": [],
        "section_order": [],
        "field_overrides": {
            "comparables": { "min_count": 5, "require_ranking": true },
            "condition_notes": { "required": true, "min_length": 50 },
            "market_commentary": { "required": true, "min_length": 100 }
        },
        "inline_reminders": [
            { "trigger_field": "comparables", "condition": "count < 5", "message": "VAS requires minimum 5 comparable properties", "severity": "warning" },
            { "trigger_field": "market_commentary", "condition": "empty", "message": "VAS expects additional local market commentary", "severity": "info" }
        ],
        "qa_rules": [
            "Verify at least 5 comparable properties are included with full addresses and sale prices",
            "Check that comparables are ranked by relevance (strongest first, weakest last)",
            "Ensure an Executive Summary section is present and concise (under 300 words)",
            "Verify local market commentary includes area-specific supply/demand data"
        ],
        "boilerplate_overrides": {},
        "branding_overrides": {}
    }'::jsonb
),
(
    'method',
    'Method Panel',
    'Method Surveying — additional local market section, minimum 3 comps, detailed condition notes',
    '{
        "version": "1.0",
        "extra_sections": [
            {
                "id": "panel_exec_summary",
                "type": "narrative",
                "title": "Executive Summary",
                "insert_after": "cover",
                "ai_section_key": "exec_summary",
                "panel_boilerplate": null
            },
            {
                "id": "panel_local_market",
                "type": "narrative",
                "title": "Local Market Analysis",
                "insert_after": "tenure_market",
                "ai_section_key": "local_market_analysis",
                "panel_boilerplate": null
            }
        ],
        "hidden_sections": [],
        "section_order": [],
        "field_overrides": {
            "comparables": { "min_count": 3, "require_ranking": false },
            "condition_notes": { "required": true, "min_length": 80 }
        },
        "inline_reminders": [
            { "trigger_field": "comparables", "condition": "count < 3", "message": "Method requires minimum 3 comparable properties", "severity": "warning" },
            { "trigger_field": "condition_notes", "condition": "length < 80", "message": "Method expects detailed condition commentary (min 80 chars)", "severity": "info" }
        ],
        "qa_rules": [
            "Verify at least 3 comparable properties with adjustment rationale",
            "Ensure detailed condition commentary covers interior and exterior",
            "Check that a Local Market Analysis section is present with area-specific data"
        ],
        "boilerplate_overrides": {},
        "branding_overrides": {}
    }'::jsonb
);
