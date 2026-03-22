-- Add UPRN column to price_paid_cache for universal UPRN-anchored data access.
-- Resolved by pre-matching PPD addresses to EPC records (which carry UPRN from the API).

ALTER TABLE price_paid_cache ADD COLUMN IF NOT EXISTS uprn TEXT;

CREATE INDEX IF NOT EXISTS idx_ppc_uprn ON price_paid_cache (uprn) WHERE uprn IS NOT NULL;
