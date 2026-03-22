-- Migration 024: Allow firm members to see other members in their firm
--
-- The existing policy "Members see own firm members" only shows user_id = auth.uid().
-- For the review flow, users need to see other members of their firm to select a reviewer.
-- Uses get_user_firm_id() (SECURITY DEFINER from migration 015) to avoid infinite recursion.
--
-- Rollback:
--   DROP POLICY IF EXISTS "Members see all firm members in own firm" ON firm_members;

CREATE POLICY "Members see all firm members in own firm"
  ON firm_members FOR SELECT
  USING (
    firm_id = get_user_firm_id()
  );
