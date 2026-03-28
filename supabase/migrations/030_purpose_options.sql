-- Add purpose_options column to firm_templates
-- Stores a JSON array of valuation purpose choices (editable per firm)
ALTER TABLE firm_templates
  ADD COLUMN IF NOT EXISTS purpose_options text;

COMMENT ON COLUMN firm_templates.purpose_options IS 'JSON array of valuation purpose dropdown options, e.g. ["Secured Lending","Probate","CGT"]';
