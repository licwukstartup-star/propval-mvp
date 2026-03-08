-- EPC bulk cache: stores latest EPC certificate per property address.
-- Downloaded per outward code alongside PPD cache for instant enrichment.

CREATE TABLE IF NOT EXISTS epc_cache (
    lmk_key          TEXT PRIMARY KEY,           -- EPC unique key (lodgement identifier)
    outward_code     TEXT NOT NULL,
    postcode         TEXT NOT NULL,
    address1         TEXT,                        -- flat/unit line
    address2         TEXT,                        -- building/street line
    address3         TEXT,
    address          TEXT,                        -- full concatenated address
    property_type    TEXT,                        -- e.g. "Flat", "House", "Maisonette"
    built_form       TEXT,                        -- e.g. "Purpose-built", "Converted"
    floor_area       REAL,                        -- total floor area in sqm
    number_rooms     INTEGER,                     -- habitable rooms (proxy for bedrooms)
    energy_rating    TEXT,                        -- A-G letter grade
    energy_score     INTEGER,                     -- 0-100 SAP score
    construction_year TEXT,                       -- e.g. "2005" or blank
    construction_age TEXT,                        -- e.g. "2003-2006" band
    tenure           TEXT,                        -- "rental (social)" / "owner-occupied" / "rental (private)"
    lodgement_date   DATE,                        -- when certificate was lodged
    fetched_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_epc_outward   ON epc_cache (outward_code);
CREATE INDEX IF NOT EXISTS idx_epc_postcode  ON epc_cache (postcode);
CREATE INDEX IF NOT EXISTS idx_epc_address   ON epc_cache (postcode, address1, address2);

-- Track EPC cache freshness per outward code (same pattern as ppd_cache_status)
CREATE TABLE IF NOT EXISTS epc_cache_status (
    outward_code  TEXT PRIMARY KEY,
    last_fetched  TIMESTAMPTZ NOT NULL,
    row_count     INTEGER DEFAULT 0
);
