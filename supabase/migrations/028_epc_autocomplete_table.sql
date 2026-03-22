-- ============================================================================
-- Migration 028: Lightweight autocomplete lookup table
-- Deduplicated EPC addresses (latest cert per address) for fast typeahead.
-- Replaces querying the full 4.4M row epc_certificates table.
-- ============================================================================

CREATE TABLE IF NOT EXISTS epc_addresses (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    postcode        TEXT NOT NULL,
    outward_code    TEXT NOT NULL,
    address1        TEXT,
    address2        TEXT,
    address3        TEXT,
    address         TEXT,
    uprn            TEXT
);

-- The only index that matters: postcode lookup
CREATE INDEX IF NOT EXISTS idx_epc_addr_postcode ON epc_addresses(postcode);

-- RLS
ALTER TABLE epc_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read epc_addresses"
    ON epc_addresses FOR SELECT
    USING (auth.role() = 'authenticated');

-- Updated autocomplete RPC: query the lightweight table
CREATE OR REPLACE FUNCTION autocomplete_by_postcode(pc TEXT)
RETURNS TABLE (
    address1 TEXT,
    address2 TEXT,
    address3 TEXT,
    address  TEXT,
    postcode TEXT,
    uprn     TEXT
)
LANGUAGE sql
STABLE
SET statement_timeout = '5s'
AS $$
    SELECT e.address1, e.address2, e.address3,
           e.address, e.postcode, e.uprn
    FROM epc_addresses e
    WHERE e.postcode = pc
    LIMIT 2000;
$$;
