-- Add UPRN fields to epc_cache.
-- EPC API returns uprn and uprn-source on every record.
-- Storing these enables UPRN-anchored comparable enrichment without live API calls.

ALTER TABLE epc_cache ADD COLUMN IF NOT EXISTS uprn        TEXT;
ALTER TABLE epc_cache ADD COLUMN IF NOT EXISTS uprn_source TEXT;

CREATE INDEX IF NOT EXISTS idx_epc_uprn ON epc_cache (uprn) WHERE uprn IS NOT NULL;
