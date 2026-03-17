-- Split building_description AI prompt into three sub-sections:
-- subject_development, subject_building, subject_property
--
-- Also ensures the base ai_prompt columns exist (they may have been added manually).

-- Ensure base AI prompt columns exist
ALTER TABLE firm_templates ADD COLUMN IF NOT EXISTS ai_prompt_location TEXT DEFAULT '';
ALTER TABLE firm_templates ADD COLUMN IF NOT EXISTS ai_prompt_market TEXT DEFAULT '';
ALTER TABLE firm_templates ADD COLUMN IF NOT EXISTS ai_prompt_valuation TEXT DEFAULT '';

-- New split columns for section 2.3
ALTER TABLE firm_templates ADD COLUMN IF NOT EXISTS ai_prompt_subject_development TEXT DEFAULT '';
ALTER TABLE firm_templates ADD COLUMN IF NOT EXISTS ai_prompt_subject_building TEXT DEFAULT '';
ALTER TABLE firm_templates ADD COLUMN IF NOT EXISTS ai_prompt_subject_property TEXT DEFAULT '';

-- Migrate any existing ai_prompt_building content to ai_prompt_subject_building
-- (best-effort: the old single prompt most closely maps to the building sub-section)
UPDATE firm_templates
SET ai_prompt_subject_building = ai_prompt_building
WHERE ai_prompt_building IS NOT NULL AND ai_prompt_building != ''
  AND (ai_prompt_subject_building IS NULL OR ai_prompt_subject_building = '');
