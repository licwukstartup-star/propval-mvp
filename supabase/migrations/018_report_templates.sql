-- ============================================================
-- 018: Report Templates (ARTG — Adaptive Report Template Generator)
-- ============================================================
-- Self-contained table for user/system report templates.
-- Each template stores a JSON schema defining sections, branding, layout.
-- Templates can be system-provided, AI-parsed from uploaded .docx, or custom-built.

CREATE TABLE IF NOT EXISTS report_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firm_id         UUID,                                   -- nullable: NULL = system template
    created_by      UUID REFERENCES auth.users(id),         -- nullable: NULL = system template
    name            TEXT NOT NULL,
    description     TEXT,
    source          TEXT NOT NULL DEFAULT 'custom'
                    CHECK (source IN ('system', 'uploaded', 'custom')),
    schema          JSONB NOT NULL DEFAULT '{}'::jsonb,      -- the template definition
    original_docx   TEXT,                                   -- Supabase Storage path (uploaded templates)
    thumbnail       TEXT,                                   -- Preview image storage path
    is_default      BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for listing user/firm templates quickly
CREATE INDEX idx_report_templates_created_by ON report_templates(created_by);
CREATE INDEX idx_report_templates_source ON report_templates(source);

-- Link cases to templates (nullable — existing cases keep working)
ALTER TABLE cases ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES report_templates(id);

-- ── Row Level Security ──────────────────────────────────────────────────
ALTER TABLE report_templates ENABLE ROW LEVEL SECURITY;

-- System templates: all authenticated users can read
CREATE POLICY "system_templates_select"
    ON report_templates FOR SELECT
    USING (source = 'system');

-- Own templates: full CRUD for creator
CREATE POLICY "own_templates_select"
    ON report_templates FOR SELECT
    USING (created_by = auth.uid());

CREATE POLICY "own_templates_insert"
    ON report_templates FOR INSERT
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "own_templates_update"
    ON report_templates FOR UPDATE
    USING (created_by = auth.uid());

CREATE POLICY "own_templates_delete"
    ON report_templates FOR DELETE
    USING (created_by = auth.uid());

-- ── Seed: PropVal Standard template (system) ────────────────────────────
-- Matches current hardcoded report structure so existing workflow is unchanged
INSERT INTO report_templates (name, description, source, is_default, schema) VALUES (
    'PropVal Standard',
    'Default RICS-compliant residential valuation report template matching the current PropVal layout.',
    'system',
    true,
    '{
        "version": "1.0",
        "page": {
            "size": "A4",
            "margins": { "top": 1440, "right": 1440, "bottom": 1440, "left": 1440 },
            "orientation": "portrait"
        },
        "branding": {
            "font_family": "Calibri",
            "font_size": 11,
            "accent_color": "#007AFF"
        },
        "header": {
            "layout": "logo-left-text-right",
            "content": ["{{firm_name}}", "{{firm_address}}", "{{firm_rics_number}}"]
        },
        "footer": {
            "content": "Page {{page_number}} of {{total_pages}}"
        },
        "sections": [
            {
                "id": "cover",
                "type": "cover_page",
                "title": "Residential Valuation Report",
                "fields": ["property_address", "valuation_date", "client_name", "report_ref"]
            },
            {
                "id": "instructions_scope",
                "type": "boilerplate",
                "title": "1. Instructions & Scope of Valuation",
                "source": "firm_templates",
                "subsections": [
                    { "id": "instructions", "title": "1.1 Instructions", "type": "boilerplate", "source_field": "instructions" },
                    { "id": "purpose", "title": "1.2 Purpose of Valuation", "type": "boilerplate", "source_field": "purpose" },
                    { "id": "responsibility", "title": "1.3 Responsibility", "type": "boilerplate", "source_field": "responsibility" },
                    { "id": "disclosure", "title": "1.4 Disclosure", "type": "boilerplate", "source_field": "disclosure" },
                    { "id": "basis", "title": "1.7 Basis of Valuation", "type": "data_field", "fields": ["basis_market_value", "basis_market_rent", "basis_mv_90day"] },
                    { "id": "conflict", "title": "1.8 Conflict of Interest", "type": "data_field", "fields": ["conflict_of_interest", "conflict_notes"] },
                    { "id": "expertise", "title": "1.12 Expertise", "type": "boilerplate", "source_field": "expertise" },
                    { "id": "inspection", "title": "1.13 Inspection", "type": "boilerplate", "source_field": "inspection" },
                    { "id": "assumptions", "title": "1.14 Special Assumptions", "type": "data_field", "fields": ["assumption_no_deleterious", "assumption_no_contamination", "assumption_good_title", "assumption_statutory_compliance"] }
                ]
            },
            {
                "id": "property",
                "type": "narrative",
                "title": "2. The Property",
                "subsections": [
                    { "id": "locality", "title": "2.1 Location & Locality", "type": "narrative", "ai_section_key": "location_description" },
                    { "id": "description", "title": "2.2 Description", "type": "narrative", "ai_section_key": "subject_building" },
                    { "id": "accommodation", "title": "2.3 Accommodation", "type": "narrative", "ai_section_key": "subject_property" },
                    { "id": "measurement", "title": "2.4 Measurement", "type": "data_field", "fields": ["gia_sqm", "gia_adopted_epc"] },
                    { "id": "site_area", "title": "2.5 Site Area", "type": "data_field", "fields": ["site_area_sqm"] },
                    { "id": "services", "title": "2.7 Services", "type": "data_field", "fields": ["service_gas", "service_water", "service_electricity", "service_drainage"] },
                    { "id": "condition", "title": "2.8 Condition", "type": "data_field", "fields": ["condition_rating", "condition_notes"] },
                    { "id": "environmental", "title": "2.9 Environmental", "type": "boilerplate", "source_field": "environmental" }
                ]
            },
            {
                "id": "tenure_market",
                "type": "narrative",
                "title": "3. Tenure & Market",
                "subsections": [
                    { "id": "tenure", "title": "3.1 Tenure", "type": "auto", "source": "property_data" },
                    { "id": "market", "title": "3.2 Market Commentary", "type": "narrative", "ai_section_key": "market_commentary" }
                ]
            },
            {
                "id": "valuation",
                "type": "valuation_summary",
                "title": "4. Valuation",
                "subsections": [
                    { "id": "considerations", "title": "4.1 Valuation Considerations", "type": "narrative", "ai_section_key": "valuation_considerations" },
                    { "id": "market_rent", "title": "4.2 Market Rent", "type": "data_field", "fields": ["market_rent", "market_rent_frequency"] },
                    { "id": "market_value", "title": "4.3 Market Value", "type": "data_field", "fields": ["market_value"] },
                    { "id": "suitable_security", "title": "4.4 Suitable Security", "type": "data_field", "fields": ["suitable_security"] },
                    { "id": "birc", "title": "4.5 BIRC", "type": "data_field", "fields": ["birc_value", "birc_rate_psm"] }
                ]
            },
            {
                "id": "comparables",
                "type": "comparables_table",
                "title": "5. Comparable Evidence",
                "columns": ["address", "price", "date", "type", "area", "price_per_sqm", "adjustments"],
                "max_rows": 6
            },
            {
                "id": "appendices",
                "type": "appendices",
                "title": "Appendices",
                "subsections": [
                    { "id": "terms", "title": "I — Terms of Engagement", "type": "placeholder" },
                    { "id": "location_plan", "title": "II — Location Plan", "type": "image", "source": "map" },
                    { "id": "photographs", "title": "III — Photographs", "type": "image_grid", "layout": "2x3" },
                    { "id": "comparables_map", "title": "IV — Comparables Map", "type": "image", "source": "comp_map" },
                    { "id": "epc", "title": "V — EPC Certificate", "type": "placeholder" }
                ]
            }
        ]
    }'::jsonb
);
