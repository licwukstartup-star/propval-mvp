-- Security hardening: Enable RLS on all remaining tables.
-- Cache tables are backend-only (service role bypasses RLS),
-- so we enable RLS with read-only policies for authenticated users.

-- EPC cache: read-only for authenticated users
ALTER TABLE epc_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read EPC cache"
    ON epc_cache FOR SELECT
    USING (auth.role() = 'authenticated');

ALTER TABLE epc_cache_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read EPC cache status"
    ON epc_cache_status FOR SELECT
    USING (auth.role() = 'authenticated');

-- PPD cache: read-only for authenticated users
ALTER TABLE price_paid_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read PPD cache"
    ON price_paid_cache FOR SELECT
    USING (auth.role() = 'authenticated');

ALTER TABLE ppd_cache_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read PPD cache status"
    ON ppd_cache_status FOR SELECT
    USING (auth.role() = 'authenticated');

-- Outward code adjacency: read-only reference data
ALTER TABLE outward_code_adjacency ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read adjacency"
    ON outward_code_adjacency FOR SELECT
    USING (auth.role() = 'authenticated');
