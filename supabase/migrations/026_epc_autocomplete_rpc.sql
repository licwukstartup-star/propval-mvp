-- RPC function for fast EPC address autocomplete.
-- Runs server-side with a 5s statement timeout, eliminating
-- PostgREST .range() COUNT overhead that caused cold-postcode timeouts.
-- Called by backend /api/property/autocomplete endpoint.

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
    FROM epc_cache e
    WHERE e.postcode = pc
    LIMIT 2000;
$$;
