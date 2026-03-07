-- Comparable transactions cache (Land Registry + EPC enriched)
-- See: comparable-selection-architecture (2026-03-04).md §8

CREATE TABLE comparable_transactions (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id       TEXT UNIQUE,
    address              TEXT NOT NULL,
    paon                 TEXT,
    saon                 TEXT,
    street               TEXT,
    street_normalised    TEXT,
    postcode             TEXT NOT NULL,
    outward_code         TEXT NOT NULL,
    inward_code          TEXT NOT NULL,
    uprn                 TEXT,

    tenure               TEXT NOT NULL CHECK (tenure IN ('freehold', 'leasehold')),
    property_type        TEXT NOT NULL CHECK (property_type IN ('flat', 'house')),
    house_sub_type       TEXT CHECK (house_sub_type IN ('detached', 'semi-detached', 'terraced', 'end-terrace')),
    bedrooms             SMALLINT,
    floor_area_sqm       NUMERIC,
    build_year           SMALLINT,
    building_era         TEXT CHECK (building_era IN ('period', 'modern')),
    building_name        TEXT,
    building_name_normalised TEXT,
    development_name     TEXT,

    price                INTEGER NOT NULL,
    transaction_date     DATE NOT NULL,
    new_build            BOOLEAN DEFAULT FALSE,
    transaction_category TEXT CHECK (transaction_category IN ('A', 'B')),

    epc_matched          BOOLEAN DEFAULT FALSE,
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_comp_outward    ON comparable_transactions(outward_code);
CREATE INDEX idx_comp_postcode   ON comparable_transactions(postcode);
CREATE INDEX idx_comp_building   ON comparable_transactions(outward_code, building_name_normalised);
CREATE INDEX idx_comp_street     ON comparable_transactions(outward_code, street_normalised);
CREATE INDEX idx_comp_date       ON comparable_transactions(transaction_date DESC);
CREATE INDEX idx_comp_hard_deck  ON comparable_transactions(tenure, property_type, building_era, bedrooms);

-- Pre-computed adjacent outward codes
CREATE TABLE outward_code_adjacency (
    outward_code  TEXT NOT NULL,
    adjacent_code TEXT NOT NULL,
    distance_m    FLOAT,
    PRIMARY KEY (outward_code, adjacent_code)
);

-- Valuer's selected comparables per case
CREATE TABLE case_comparables (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id         UUID NOT NULL,   -- references cases(id) when cases table exists
    transaction_id  UUID REFERENCES comparable_transactions(id),
    source          TEXT NOT NULL CHECK (source IN ('system', 'manual')),
    selected        BOOLEAN DEFAULT FALSE,
    rejected        BOOLEAN DEFAULT FALSE,
    rejection_reason TEXT,
    geographic_tier  SMALLINT,
    tier_label       TEXT,
    spec_relaxations TEXT[],
    valuer_notes     TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE comparable_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read transactions"
    ON comparable_transactions FOR SELECT
    USING (auth.role() = 'authenticated');

ALTER TABLE case_comparables ENABLE ROW LEVEL SECURITY;
-- Uncomment when cases table exists:
-- CREATE POLICY "Surveyors see own case comparables"
--     ON case_comparables FOR ALL
--     USING (case_id IN (SELECT id FROM cases WHERE surveyor_id = auth.uid()));
