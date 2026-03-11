-- Add ui_state JSONB column to cases table for persisting UI preferences per case
ALTER TABLE cases ADD COLUMN IF NOT EXISTS ui_state JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN cases.ui_state IS 'Persisted UI state: active tab, map layers, tile layer, card sizes';
