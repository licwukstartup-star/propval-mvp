-- ============================================================
-- Migration 015: Firm Infrastructure
-- ============================================================
-- Prerequisites for multi-tenancy and Option E (UPRN Timeline).
-- Creates firms + firm_members tables, adds firm_id to cases,
-- and updates RLS to support firm-scoped access.
--
-- IMPORTANT: Tables are created FIRST, then all RLS policies
-- added AFTER — because policies cross-reference both tables.
-- ============================================================

-- ============================================================
-- STEP 1: Create tables (no policies yet)
-- ============================================================

-- 1a. Create firms table
CREATE TABLE IF NOT EXISTS firms (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    slug            TEXT UNIQUE,          -- URL-friendly identifier (e.g. "jll-london")
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- 1b. Create firm_members junction table
CREATE TABLE IF NOT EXISTS firm_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firm_id         UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL,        -- references auth.users(id)
    role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    joined_at       TIMESTAMPTZ DEFAULT now(),
    UNIQUE(firm_id, user_id)
);

-- 1c. Ensure is_deleted exists (migration 010 may not have run)
ALTER TABLE cases ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;

-- 1d. Add firm_id to cases table
ALTER TABLE cases ADD COLUMN IF NOT EXISTS firm_id UUID REFERENCES firms(id);
CREATE INDEX IF NOT EXISTS idx_cases_firm ON cases(firm_id);

-- 1d. Add firm_id to firm_templates table
ALTER TABLE firm_templates ADD COLUMN IF NOT EXISTS firm_id UUID REFERENCES firms(id);
CREATE INDEX IF NOT EXISTS idx_firm_templates_firm ON firm_templates(firm_id);

-- ============================================================
-- STEP 2: Enable RLS on new tables
-- ============================================================

ALTER TABLE firms ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_members ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- STEP 3: Add all RLS policies (both tables now exist)
-- ============================================================

-- firms: members can read their own firm
CREATE POLICY "Members can read own firm" ON firms
    FOR SELECT USING (
        id IN (SELECT fm.firm_id FROM firm_members fm WHERE fm.user_id = auth.uid())
    );

-- firms: admin can see all
CREATE POLICY "Admin: full firm access" ON firms
    FOR ALL USING (
        (auth.jwt()->'user_metadata'->>'role') = 'admin'
    );

-- firm_members: members can see their own firm's members
-- NOTE: Uses direct user_id check (not a subquery on firm_members) to avoid
-- infinite recursion — this table's own RLS would re-trigger the same policy.
CREATE POLICY "Members see own firm members" ON firm_members
    FOR SELECT USING (user_id = auth.uid());

-- firm_members: admin can see all
CREATE POLICY "Admin: full firm_members access" ON firm_members
    FOR ALL USING (
        (auth.jwt()->'user_metadata'->>'role') = 'admin'
    );

-- ============================================================
-- STEP 4: Helper function
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_firm_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT firm_id FROM firm_members WHERE user_id = auth.uid() LIMIT 1;
$$;

-- ============================================================
-- STEP 5: Update existing table RLS policies
-- ============================================================

-- cases: drop old policy, create new one supporting firm_id
DROP POLICY IF EXISTS "Surveyors see own cases" ON cases;

CREATE POLICY "Users see own firm cases" ON cases
    FOR ALL USING (
        is_deleted = false
        AND (
            surveyor_id = auth.uid()
            OR firm_id IN (SELECT fm.firm_id FROM firm_members fm WHERE fm.user_id = auth.uid())
        )
    );

-- cases: admin sees everything (including soft-deleted for support)
CREATE POLICY "Admin: full case access" ON cases
    FOR ALL USING (
        (auth.jwt()->'user_metadata'->>'role') = 'admin'
    );

-- firm_templates: drop old policy, create new one supporting firm_id
DROP POLICY IF EXISTS "Surveyors manage own firm template" ON firm_templates;

CREATE POLICY "Users manage own firm templates" ON firm_templates
    FOR ALL USING (
        surveyor_id = auth.uid()
        OR firm_id IN (SELECT fm.firm_id FROM firm_members fm WHERE fm.user_id = auth.uid())
    );

-- ============================================================
-- BACKFILL INSTRUCTIONS (run manually after migration):
-- ============================================================
-- For Phase 1 (single firm, single surveyor):
--
-- 1. Create the firm:
--    INSERT INTO firms (id, name, slug)
--    VALUES (gen_random_uuid(), 'PropVal', 'propval');
--
-- 2. Link Terry to the firm:
--    INSERT INTO firm_members (firm_id, user_id, role)
--    SELECT f.id, '<TERRY_USER_ID>', 'admin'
--    FROM firms f WHERE f.slug = 'propval';
--
-- 3. Backfill firm_id on existing cases:
--    UPDATE cases SET firm_id = (SELECT id FROM firms WHERE slug = 'propval');
--
-- 4. Backfill firm_id on firm_templates:
--    UPDATE firm_templates SET firm_id = (SELECT id FROM firms WHERE slug = 'propval');
--
-- 5. Add firm_id to Terry's app_metadata in Supabase Auth:
--    UPDATE auth.users
--    SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object(
--        'firm_id', (SELECT id::text FROM firms WHERE slug = 'propval')
--    )
--    WHERE id = '<TERRY_USER_ID>';
-- ============================================================
