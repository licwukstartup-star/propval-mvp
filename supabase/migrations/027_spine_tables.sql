-- ============================================================================
-- Migration 027: Spine Tables
-- Creates the core data spine: transactions, epc_certificates,
-- unmatched_transactions, registered_leases.
-- Replaces: DuckDB matched/unmatched/epc, SQLite leases.db,
--           price_paid_cache, epc_cache (to be dropped later)
-- ============================================================================

-- 1. TRANSACTIONS (PPD + EPC pre-matched, with UPRN + coordinates)
CREATE TABLE IF NOT EXISTS transactions (
    transaction_id          TEXT PRIMARY KEY,

    -- PPD core
    price                   INTEGER NOT NULL,
    date_of_transfer        DATE NOT NULL,
    postcode                TEXT NOT NULL,
    outward_code            TEXT NOT NULL,
    saon                    TEXT,
    paon                    TEXT,
    street                  TEXT,
    district                TEXT,
    ppd_type                CHAR(1),
    duration                CHAR(1),
    old_new                 CHAR(1),
    ppd_category            CHAR(1),

    -- UPRN backbone
    uprn                    TEXT,
    uprn_source             TEXT,

    -- Pre-matched EPC fields (denormalised)
    lmk_key                 TEXT,
    epc_property_type       TEXT,
    epc_built_form          TEXT,
    floor_area_sqm          REAL,
    habitable_rooms         SMALLINT,
    energy_rating           CHAR(1),
    energy_score            SMALLINT,
    construction_age_band   TEXT,

    -- Construction age (from PropVal pipeline)
    age_best                SMALLINT,
    age_estimated           BOOLEAN DEFAULT false,
    age_source              TEXT,

    -- Coordinates (pre-joined from OS Open UPRN)
    lat                     DOUBLE PRECISION,
    lon                     DOUBLE PRECISION,
    coord_source            TEXT,

    -- Refresh metadata
    spine_version           DATE NOT NULL,
    created_at              TIMESTAMPTZ DEFAULT now()
);

-- Primary search indexes
CREATE INDEX IF NOT EXISTS idx_tx_outward_date ON transactions(outward_code, date_of_transfer DESC);
CREATE INDEX IF NOT EXISTS idx_tx_postcode_date ON transactions(postcode, date_of_transfer DESC);
CREATE INDEX IF NOT EXISTS idx_tx_uprn ON transactions(uprn) WHERE uprn IS NOT NULL;

-- Hard-deck filter (comparable engine)
CREATE INDEX IF NOT EXISTS idx_tx_hard_deck ON transactions(
    outward_code, duration, ppd_type, date_of_transfer DESC
);

-- Building search (flats: same building)
CREATE INDEX IF NOT EXISTS idx_tx_building ON transactions(outward_code, paon)
    WHERE ppd_type = 'F';

-- Street search
CREATE INDEX IF NOT EXISTS idx_tx_street ON transactions(outward_code, street, date_of_transfer DESC);

-- District (borough-level queries, AVM)
CREATE INDEX IF NOT EXISTS idx_tx_district ON transactions(district, date_of_transfer DESC);

-- Autocomplete support (sale history by address)
CREATE INDEX IF NOT EXISTS idx_tx_postcode_saon ON transactions(postcode, saon, paon);

-- RLS
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read transactions"
    ON transactions FOR SELECT
    USING (auth.role() = 'authenticated');


-- 2. EPC_CERTIFICATES (full EPC dataset for autocomplete + property details)
CREATE TABLE IF NOT EXISTS epc_certificates (
    lmk_key                 TEXT PRIMARY KEY,

    uprn                    TEXT,
    uprn_source             TEXT,
    postcode                TEXT NOT NULL,
    outward_code            TEXT NOT NULL,
    address1                TEXT,
    address2                TEXT,
    address3                TEXT,
    address                 TEXT,
    property_type           TEXT,
    built_form              TEXT,
    floor_area_sqm          REAL,
    habitable_rooms         SMALLINT,
    energy_rating           CHAR(1),
    energy_score            SMALLINT,
    construction_age_band   TEXT,
    construction_year       TEXT,
    tenure                  TEXT,
    lodgement_date          DATE,
    inspection_date         DATE,
    local_authority         TEXT,

    -- Construction age (from PropVal pipeline)
    age_best                SMALLINT,
    age_estimated           BOOLEAN DEFAULT false,
    age_source              TEXT,

    -- Refresh metadata
    spine_version           DATE NOT NULL,
    created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_epc_postcode ON epc_certificates(postcode);
CREATE INDEX IF NOT EXISTS idx_epc_outward ON epc_certificates(outward_code);
CREATE INDEX IF NOT EXISTS idx_epc_uprn ON epc_certificates(uprn) WHERE uprn IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_epc_address ON epc_certificates(postcode, address1, address2);

-- RLS
ALTER TABLE epc_certificates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read epc_certificates"
    ON epc_certificates FOR SELECT
    USING (auth.role() = 'authenticated');


-- 3. UNMATCHED_TRANSACTIONS (PPD records without EPC match)
CREATE TABLE IF NOT EXISTS unmatched_transactions (
    transaction_id          TEXT PRIMARY KEY,

    price                   INTEGER NOT NULL,
    date_of_transfer        DATE NOT NULL,
    postcode                TEXT,
    outward_code            TEXT,
    saon                    TEXT,
    paon                    TEXT,
    street                  TEXT,
    locality                TEXT,
    town                    TEXT,
    district                TEXT,
    county                  TEXT,
    ppd_type                CHAR(1),
    duration                CHAR(1),
    old_new                 CHAR(1),
    ppd_category            CHAR(1),

    spine_version           DATE NOT NULL,
    created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_unm_postcode ON unmatched_transactions(postcode);
CREATE INDEX IF NOT EXISTS idx_unm_outward ON unmatched_transactions(outward_code, date_of_transfer DESC);
CREATE INDEX IF NOT EXISTS idx_unm_postcode_saon ON unmatched_transactions(postcode, saon, paon);

-- RLS
ALTER TABLE unmatched_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read unmatched_transactions"
    ON unmatched_transactions FOR SELECT
    USING (auth.role() = 'authenticated');


-- 4. REGISTERED_LEASES (replaces leases.db)
CREATE TABLE IF NOT EXISTS registered_leases (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uprn                    TEXT NOT NULL,
    date_of_lease           DATE,
    term_years              SMALLINT,
    expiry_date             DATE,

    spine_version           DATE NOT NULL,
    created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lease_uprn ON registered_leases(uprn);

-- RLS
ALTER TABLE registered_leases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read registered_leases"
    ON registered_leases FOR SELECT
    USING (auth.role() = 'authenticated');


-- 5. Updated autocomplete RPC to query epc_certificates
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
    SELECT DISTINCT ON (e.address)
           e.address1, e.address2, e.address3,
           e.address, e.postcode, e.uprn
    FROM epc_certificates e
    WHERE e.postcode = pc
    ORDER BY e.address, e.lodgement_date DESC
    LIMIT 2000;
$$;
