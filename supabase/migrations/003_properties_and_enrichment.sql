-- Tier 1: Property Library
-- UPRN-anchored master record for each property ever searched.
-- Populated/updated automatically on every property search.

CREATE TABLE properties (
    uprn                TEXT PRIMARY KEY,
    canonical_address   TEXT NOT NULL,
    postcode            TEXT,
    lat                 DOUBLE PRECISION,
    lon                 DOUBLE PRECISION,
    property_type       TEXT,           -- e.g. 'Flat', 'House', 'Maisonette'
    built_form          TEXT,           -- e.g. 'Purpose-Built', 'Converted'
    construction_era    TEXT,           -- e.g. '1976-1982'
    floor_area_sqm      NUMERIC,
    habitable_rooms     INTEGER,
    admin_district      TEXT,
    lsoa_code           TEXT,
    region              TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_properties_postcode ON properties(postcode);

-- Cached API responses per data source.
-- Each source stores its full JSON payload plus a fetch timestamp
-- so we can decide whether to re-fetch or serve from cache.

CREATE TABLE property_enrichment (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uprn            TEXT NOT NULL REFERENCES properties(uprn) ON DELETE CASCADE,
    data_source     TEXT NOT NULL,       -- e.g. 'epc', 'land_registry', 'flood_risk', 'listed_buildings', etc.
    payload         JSONB NOT NULL,
    fetched_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(uprn, data_source)
);

CREATE INDEX idx_enrichment_uprn ON property_enrichment(uprn);
CREATE INDEX idx_enrichment_source ON property_enrichment(data_source);

-- RLS: any authenticated user can read properties (shared library)
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_enrichment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read properties"
    ON properties FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can read enrichment"
    ON property_enrichment FOR SELECT
    USING (auth.role() = 'authenticated');

-- Service role (backend) can insert/update via service_role key, which bypasses RLS.
-- No additional INSERT/UPDATE policies needed for end users.
