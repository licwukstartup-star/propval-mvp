-- ============================================================================
-- Migration 028: AI Data Flywheel Infrastructure
--
-- Three tables + column additions that silently capture training signal from
-- every valuer interaction with AI features. No UI changes needed.
--
-- 1. valuer_feedback    — captures AI output vs valuer's final choice
-- 2. prompt_registry    — versioned prompts for A/B testing & rollback
-- 3. case_comps columns — citation graph edges (weight, role, adjustment)
-- 4. ai_usage_log cols  — quality tracking (section, property type, borough)
--
-- Rollback:
--   ALTER TABLE case_comps DROP COLUMN IF EXISTS opinion_of_value;
--   ALTER TABLE case_comps DROP COLUMN IF EXISTS adjustment_applied;
--   ALTER TABLE case_comps DROP COLUMN IF EXISTS weight_assigned;
--   ALTER TABLE case_comps DROP COLUMN IF EXISTS citation_role;
--   DROP POLICY IF EXISTS "Service role writes feedback" ON valuer_feedback;
--   DROP POLICY IF EXISTS "Admins read all feedback" ON valuer_feedback;
--   DROP POLICY IF EXISTS "Users read own feedback" ON valuer_feedback;
--   DROP TABLE IF EXISTS valuer_feedback;
--   DROP POLICY IF EXISTS "Prompts readable by authenticated" ON prompt_registry;
--   DROP POLICY IF EXISTS "Admin manages prompts" ON prompt_registry;
--   DROP TABLE IF EXISTS prompt_registry;
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. VALUER FEEDBACK — every AI interaction becomes a training signal
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS valuer_feedback (
    id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    firm_id             UUID,
    user_id             UUID NOT NULL REFERENCES auth.users(id),
    case_id             UUID REFERENCES cases(id) ON DELETE SET NULL,

    -- What kind of feedback
    feedback_type       TEXT NOT NULL
        CHECK (feedback_type IN (
            'narrative_edit',       -- AI generated text, valuer edited
            'comp_selection',       -- engine suggested comps, valuer chose differently
            'value_adoption',       -- SEMV distribution shown, valuer adopted specific value
            'qa_override'           -- AI flagged issue, valuer overrode
        )),

    -- Context
    section_key         TEXT,               -- e.g. 'location_description', 'market_commentary'
    property_type       TEXT,               -- flat / house
    borough             TEXT,               -- for segmented analysis
    prompt_key          TEXT,               -- which prompt produced the AI output

    -- The delta (what AI said vs what valuer kept)
    ai_output           TEXT,               -- what AI produced
    valuer_output       TEXT,               -- what valuer kept / chose
    metadata            JSONB DEFAULT '{}', -- flexible: suggested_comps, adopted_comps, distribution_stats, etc.

    -- Property context for future model training
    property_features   JSONB,              -- subject property features at time of interaction

    created_at          TIMESTAMPTZ DEFAULT now()
);

-- Indexes for analytics queries
CREATE INDEX IF NOT EXISTS idx_vf_type      ON valuer_feedback(feedback_type);
CREATE INDEX IF NOT EXISTS idx_vf_section   ON valuer_feedback(section_key) WHERE section_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vf_borough   ON valuer_feedback(borough) WHERE borough IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vf_case      ON valuer_feedback(case_id) WHERE case_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vf_created   ON valuer_feedback(created_at DESC);

ALTER TABLE valuer_feedback ENABLE ROW LEVEL SECURITY;

-- Service role inserts (backend writes on behalf of users)
CREATE POLICY "Service role writes feedback" ON valuer_feedback
    FOR INSERT WITH CHECK (true);

-- Users can read their own feedback
CREATE POLICY "Users read own feedback" ON valuer_feedback
    FOR SELECT USING (user_id = auth.uid());

-- Admins can read all (for training data export)
CREATE POLICY "Admins read all feedback" ON valuer_feedback
    FOR SELECT USING (
        (auth.jwt()->'user_metadata'->>'role') = 'admin'
    );


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PROMPT REGISTRY — versioned prompts, A/B testable, rollbackable
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prompt_registry (
    id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    prompt_key          TEXT NOT NULL,               -- e.g. 'narrative.location', 'qa.system'
    prompt_version      INTEGER NOT NULL DEFAULT 1,
    prompt_text         TEXT NOT NULL,
    description         TEXT,                        -- human-readable note on what changed
    is_active           BOOLEAN NOT NULL DEFAULT true,

    -- Auto-calculated quality metrics (updated by backend)
    total_uses          INTEGER DEFAULT 0,
    acceptance_rate     NUMERIC,                     -- % of outputs kept unmodified
    avg_edit_distance   NUMERIC,                     -- avg Levenshtein ratio of edits

    created_at          TIMESTAMPTZ DEFAULT now(),

    UNIQUE(prompt_key, prompt_version)
);

CREATE INDEX IF NOT EXISTS idx_pr_active ON prompt_registry(prompt_key) WHERE is_active = true;

ALTER TABLE prompt_registry ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read prompts (needed by backend)
CREATE POLICY "Prompts readable by authenticated" ON prompt_registry
    FOR SELECT USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- Only admin/service role can manage
CREATE POLICY "Admin manages prompts" ON prompt_registry
    FOR ALL USING (
        (auth.jwt()->'user_metadata'->>'role') = 'admin'
        OR auth.role() = 'service_role'
    );


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. CITATION GRAPH — extend case_comps with valuation context
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE case_comps
    ADD COLUMN IF NOT EXISTS opinion_of_value   NUMERIC,
    ADD COLUMN IF NOT EXISTS adjustment_applied  JSONB,
    ADD COLUMN IF NOT EXISTS weight_assigned     NUMERIC,
    ADD COLUMN IF NOT EXISTS citation_role       TEXT DEFAULT 'supporting'
        CHECK (citation_role IN ('primary', 'supporting', 'negative', 'bracket_upper', 'bracket_lower'));


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. AI USAGE LOG — extend with quality tracking columns
--    (table may have been created outside migrations; use IF NOT EXISTS)
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
    -- Only add columns if the table exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ai_usage_log') THEN
        BEGIN ALTER TABLE ai_usage_log ADD COLUMN section_key TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END;
        BEGIN ALTER TABLE ai_usage_log ADD COLUMN property_type TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END;
        BEGIN ALTER TABLE ai_usage_log ADD COLUMN borough TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END;
        BEGIN ALTER TABLE ai_usage_log ADD COLUMN accepted_unmodified BOOLEAN; EXCEPTION WHEN duplicate_column THEN NULL; END;
        BEGIN ALTER TABLE ai_usage_log ADD COLUMN prompt_version INTEGER; EXCEPTION WHEN duplicate_column THEN NULL; END;
    END IF;
END
$$;
