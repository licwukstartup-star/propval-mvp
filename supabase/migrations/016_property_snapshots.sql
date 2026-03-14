-- ============================================================
-- Migration 016: Property Snapshots + Case Comps (Option E)
-- ============================================================
-- UPRN Timeline Log architecture.
-- Every data point is an immutable snapshot anchored to a UPRN.
-- Cases link to snapshots via a thin junction table (case_comps).
-- ============================================================

-- 1. Property Snapshots — the UPRN backbone
CREATE TABLE IF NOT EXISTS property_snapshots (
    id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,

    -- UPRN backbone (NULL for ~5% unmatched; fallback on address+postcode)
    uprn                    TEXT,

    -- Provenance (immutable — set at INSERT, never changed)
    source                  TEXT NOT NULL CHECK (source IN (
                                'hmlr_ppd',        -- System search (Direct/Wider). Government verified.
                                'epc',             -- EPC Open Data. Government verified.
                                'additional',      -- Valuer-directed search. Same official data.
                                'csv_import',      -- Uploaded from LonRes, Rightmove, CoStar, etc.
                                'manual',          -- Valuer typed everything.
                                'user_override'    -- Valuer modified a field on an adopted comp.
                            )),
    source_ref              TEXT,              -- transaction_id (HMLR), lmk_key (EPC), etc.
    created_by              UUID,              -- NULL for system-ingested, user_id for user-created
    firm_id                 UUID REFERENCES firms(id),  -- NULL for official/public data, set for user data

    -- CSV import metadata (NULL unless source = 'csv_import')
    import_provider         TEXT,              -- 'lonres', 'rightmove', 'costar', 'custom'
    import_filename         TEXT,
    import_row_number       INTEGER,

    -- Lineage (for user_override snapshots — points to the snapshot being modified)
    based_on_id             UUID REFERENCES property_snapshots(id),

    -- Property fields (the snapshot data)
    address                 TEXT NOT NULL,
    postcode                TEXT NOT NULL,
    outward_code            TEXT NOT NULL,
    saon                    TEXT,
    tenure                  TEXT,
    property_type           TEXT,              -- 'flat', 'house'
    house_sub_type          TEXT,              -- 'detached', 'semi-detached', 'terraced', etc.
    bedrooms                INTEGER,
    building_name           TEXT,
    building_era            TEXT,
    build_year              INTEGER,
    build_year_estimated    BOOLEAN DEFAULT false,
    floor_area_sqm          NUMERIC,
    price                   INTEGER,
    transaction_date        DATE,
    new_build               BOOLEAN DEFAULT false,
    transaction_category    TEXT,
    epc_rating              TEXT,              -- A-G
    epc_score               INTEGER,           -- 1-100

    -- User notes
    source_note             TEXT,              -- "Agent particulars", "Rightmove listing", etc.

    -- Compliance (GDPR + commercial data licensing)
    redacted_at             TIMESTAMPTZ,       -- GDPR erasure: NULLs personal fields when set
    licence_restricted      BOOLEAN DEFAULT false,  -- true for commercial CSV data (never promote to Tier 3)

    created_at              TIMESTAMPTZ DEFAULT now()
    -- NO updated_at — rows are IMMUTABLE
);

-- ============================================================
-- RLS: Three-tier visibility (Hard Rule 5)
-- ============================================================
-- Tier A: Official data (firm_id IS NULL) → visible to ALL authenticated users
-- Tier B: User-created data (firm_id set) → visible ONLY to same-firm users
-- Tier C: Platform admin (role = 'admin') → can see everything
-- ============================================================
ALTER TABLE property_snapshots ENABLE ROW LEVEL SECURITY;

-- All authenticated users can READ official (system-ingested) snapshots
CREATE POLICY "Official snapshots: all users can read" ON property_snapshots
    FOR SELECT USING (firm_id IS NULL);

-- Firm members can READ their own firm's user-created snapshots
CREATE POLICY "Firm snapshots: same-firm can read" ON property_snapshots
    FOR SELECT USING (
        firm_id IN (SELECT fm.firm_id FROM firm_members fm WHERE fm.user_id = auth.uid())
    );

-- Firm members can INSERT snapshots tagged to their own firm
CREATE POLICY "Firm snapshots: same-firm can insert" ON property_snapshots
    FOR INSERT WITH CHECK (
        firm_id IS NULL  -- system can insert official data
        OR firm_id IN (SELECT fm.firm_id FROM firm_members fm WHERE fm.user_id = auth.uid())
    );

-- Platform admin can see ALL snapshots (official + every firm's data)
CREATE POLICY "Admin: full snapshot access" ON property_snapshots
    FOR ALL USING (
        (auth.jwt()->'user_metadata'->>'role') = 'admin'
    );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ps_uprn ON property_snapshots(uprn);
CREATE INDEX IF NOT EXISTS idx_ps_source ON property_snapshots(source);
CREATE INDEX IF NOT EXISTS idx_ps_postcode ON property_snapshots(postcode);
CREATE INDEX IF NOT EXISTS idx_ps_outward ON property_snapshots(outward_code);
CREATE INDEX IF NOT EXISTS idx_ps_firm ON property_snapshots(firm_id);
CREATE INDEX IF NOT EXISTS idx_ps_source_ref ON property_snapshots(source_ref);
CREATE INDEX IF NOT EXISTS idx_ps_based_on ON property_snapshots(based_on_id);
CREATE INDEX IF NOT EXISTS idx_ps_created_by ON property_snapshots(created_by);

-- 2. Case Comps — junction table linking cases to adopted snapshots
CREATE TABLE IF NOT EXISTS case_comps (
    id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    case_id             UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    snapshot_id         UUID NOT NULL REFERENCES property_snapshots(id),

    -- Adoption context
    adopted_by          UUID NOT NULL,        -- user who adopted
    adopted_at          TIMESTAMPTZ DEFAULT now(),

    -- Search context (frozen at adoption time; NULL for manual/csv)
    geographic_tier     INTEGER,
    tier_label          TEXT,
    spec_relaxations    TEXT[],
    distance_m          NUMERIC,

    -- Valuer's case-specific notes
    valuer_notes        TEXT,

    -- Soft-delete (data retention compliance — GDPR Article 5(1)(c))
    unadopted_at        TIMESTAMPTZ,          -- NULL = active, set = unadopted

    UNIQUE(case_id, snapshot_id)              -- prevent duplicate adoption
);

ALTER TABLE case_comps ENABLE ROW LEVEL SECURITY;

-- Firm members see their own firm's case comps (cases already RLS'd by firm_id)
CREATE POLICY "Case comps: same-firm access" ON case_comps
    FOR ALL USING (
        case_id IN (
            SELECT id FROM cases
            WHERE surveyor_id = auth.uid()
               OR firm_id IN (SELECT fm.firm_id FROM firm_members fm WHERE fm.user_id = auth.uid())
        )
    );

-- Platform admin can see all
CREATE POLICY "Admin: full case comp access" ON case_comps
    FOR ALL USING (
        (auth.jwt()->'user_metadata'->>'role') = 'admin'
    );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cc_case ON case_comps(case_id);
CREATE INDEX IF NOT EXISTS idx_cc_snapshot ON case_comps(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_cc_adopted_by ON case_comps(adopted_by);
CREATE INDEX IF NOT EXISTS idx_cc_active ON case_comps(case_id) WHERE unadopted_at IS NULL;
