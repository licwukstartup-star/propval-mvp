-- Cache comparable search results (building + outward) on each case
-- so loading a case restores the full search without re-querying the server.
ALTER TABLE cases ADD COLUMN IF NOT EXISTS search_results JSONB DEFAULT '{}'::jsonb;
