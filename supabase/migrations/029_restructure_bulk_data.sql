-- Migration 029: Database Restructuring — Normalise bulk data tables
-- Date: 2026-03-23
--
-- WHY: The denormalised `transactions` table mixed PPD, EPC, coords, and age data
-- from different sources with different refresh lifecycles. This made refreshing
-- any single source impossible without rebuilding everything. Local SQLite files
-- (UPRN coords) couldn't scale to multiple valuers.
--
-- WHAT: Separate into normalised tables with independent lifecycles:
--   - ppd_transactions: PPD-only (HMLR, monthly)
--   - epc_certificates: EPC-only (DLUHC, quarterly) — already exists
--   - construction_age: PropVal derived ages (on demand)
--   - uprn_coordinates: OS Open UPRN via PostGIS (quarterly)
--   - VIEW `transactions`: JOINs them back together transparently
--
-- The VIEW is named `transactions` so existing backend code works unchanged.
-- EPC JOIN uses lmk_key (not uprn) to avoid duplicates from multiple EPCs per UPRN.

-- 1. Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. UPRN Coordinates (OS Open UPRN, London, ~6M rows)
CREATE TABLE IF NOT EXISTS uprn_coordinates (
    uprn    TEXT PRIMARY KEY,
    geom    GEOMETRY(Point, 4326) NOT NULL
);

ALTER TABLE uprn_coordinates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read UPRN coordinates"
    ON uprn_coordinates FOR SELECT
    USING (auth.role() = 'authenticated');

-- 3. PPD Transactions (HMLR Price Paid Data, all matched + unmatched)
CREATE TABLE IF NOT EXISTS ppd_transactions (
    transaction_id  TEXT PRIMARY KEY,
    price           INTEGER NOT NULL,
    date_of_transfer DATE NOT NULL,
    postcode        TEXT,
    outward_code    TEXT,
    saon            TEXT,
    paon            TEXT,
    street          TEXT,
    district        TEXT,
    ppd_type        CHAR(1),
    duration        CHAR(1),
    old_new         CHAR(1),
    ppd_category    CHAR(1),
    uprn            TEXT,
    lmk_key         TEXT,
    lat             DOUBLE PRECISION,
    lon             DOUBLE PRECISION,
    coord_source    TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ppd_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read PPD transactions"
    ON ppd_transactions FOR SELECT
    USING (auth.role() = 'authenticated');

-- 4. Construction Age (PropVal derived, keyed on EPC lmk_key)
CREATE TABLE IF NOT EXISTS construction_age (
    lmk_key     TEXT PRIMARY KEY,
    age_best    INTEGER,
    age_source  TEXT
);

ALTER TABLE construction_age ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read construction age"
    ON construction_age FOR SELECT
    USING (auth.role() = 'authenticated');

-- 5. Rename old denormalised table
ALTER TABLE transactions RENAME TO transactions_legacy;

-- 6. Create VIEW with exact same column names as old table
-- JOIN on lmk_key (not uprn) to avoid 1:many EPC duplicates
CREATE VIEW transactions AS
SELECT
    t.transaction_id,
    t.price,
    t.date_of_transfer,
    t.postcode,
    t.outward_code,
    t.saon,
    t.paon,
    t.street,
    t.district,
    t.ppd_type,
    t.duration,
    t.old_new,
    t.ppd_category,
    t.uprn,
    t.lmk_key,
    e.property_type   AS epc_property_type,
    e.built_form      AS epc_built_form,
    e.floor_area_sqm,
    e.habitable_rooms,
    e.energy_rating,
    e.energy_score,
    e.construction_age_band,
    ca.age_best,
    COALESCE(ST_Y(c.geom), t.lat) AS lat,
    COALESCE(ST_X(c.geom), t.lon) AS lon,
    t.coord_source
FROM ppd_transactions t
LEFT JOIN epc_certificates e ON t.lmk_key = e.lmk_key
LEFT JOIN construction_age ca ON t.lmk_key = ca.lmk_key
LEFT JOIN uprn_coordinates c ON t.uprn = c.uprn;

-- 7. RPC functions for UPRN coordinate lookups (PostGIS)
CREATE OR REPLACE FUNCTION lookup_uprn_coords(p_uprn TEXT)
RETURNS TABLE (lat DOUBLE PRECISION, lon DOUBLE PRECISION)
LANGUAGE sql STABLE AS $$
    SELECT ST_Y(geom)::DOUBLE PRECISION, ST_X(geom)::DOUBLE PRECISION
    FROM uprn_coordinates
    WHERE uprn = p_uprn
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION lookup_uprn_coords_batch(p_uprns TEXT[])
RETURNS TABLE (uprn TEXT, lat DOUBLE PRECISION, lon DOUBLE PRECISION)
LANGUAGE sql STABLE AS $$
    SELECT u.uprn, ST_Y(u.geom)::DOUBLE PRECISION, ST_X(u.geom)::DOUBLE PRECISION
    FROM uprn_coordinates u
    WHERE u.uprn = ANY(p_uprns);
$$;

-- 8. Indexes (created after bulk load)
CREATE INDEX IF NOT EXISTS idx_uprn_coords_geom ON uprn_coordinates USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_ppd_outward_date ON ppd_transactions (outward_code, date_of_transfer DESC);
CREATE INDEX IF NOT EXISTS idx_ppd_postcode_date ON ppd_transactions (postcode, date_of_transfer DESC);
CREATE INDEX IF NOT EXISTS idx_ppd_uprn ON ppd_transactions (uprn) WHERE uprn IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ppd_hard_deck ON ppd_transactions (outward_code, duration, ppd_type, date_of_transfer DESC);
CREATE INDEX IF NOT EXISTS idx_ppd_building ON ppd_transactions (outward_code, paon) WHERE ppd_type = 'F';
CREATE INDEX IF NOT EXISTS idx_ppd_street ON ppd_transactions (outward_code, street, date_of_transfer DESC);
CREATE INDEX IF NOT EXISTS idx_ppd_postcode_saon ON ppd_transactions (postcode, saon, paon);
CREATE INDEX IF NOT EXISTS idx_ppd_district ON ppd_transactions (district, date_of_transfer DESC);
CREATE INDEX IF NOT EXISTS idx_ppd_lmk_key ON ppd_transactions (lmk_key) WHERE lmk_key IS NOT NULL;

-- 9. Missing epc_certificates indexes (should have been in 027)
CREATE INDEX IF NOT EXISTS idx_epc_postcode ON epc_certificates(postcode);
CREATE INDEX IF NOT EXISTS idx_epc_outward ON epc_certificates(outward_code);
CREATE INDEX IF NOT EXISTS idx_epc_uprn ON epc_certificates(uprn) WHERE uprn IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_epc_address ON epc_certificates(postcode, address1, address2);
