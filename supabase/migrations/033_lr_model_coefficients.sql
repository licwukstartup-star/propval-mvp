-- LR model coefficients for the MC comparable adjustment engine.
-- 65 rows: 32 boroughs x 2 types (flat + house) + City of London (flat only).
-- ~227 KB total. Read-only reference table — updated only when models are retrained.

CREATE TABLE IF NOT EXISTS lr_model_coefficients (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    borough         TEXT NOT NULL,                  -- e.g. "SUTTON"
    borough_slug    TEXT NOT NULL,                  -- e.g. "sutton"
    property_type   TEXT NOT NULL CHECK (property_type IN ('flat', 'house')),

    -- Model performance
    lr_mdape        NUMERIC,                        -- validation MdAPE (%)
    mc_range_pp     INTEGER,                        -- MC range in percentage points
    intercept       NUMERIC,                        -- LR intercept (log-price space)

    -- Coefficients stored as JSONB for flexibility
    lr_coefficients_raw  JSONB NOT NULL DEFAULT '{}',   -- {feature_name: coeff_value}
    era_coefficients     JSONB NOT NULL DEFAULT '{}',   -- {era_name: coeff_value}
    scaler_means         JSONB NOT NULL DEFAULT '{}',   -- {feature_name: mean}
    scaler_scales        JSONB NOT NULL DEFAULT '{}',   -- {feature_name: std}
    train_stats          JSONB NOT NULL DEFAULT '{}',   -- {n_train, mean_floor_area_sqm, ...}
    feature_cols         JSONB NOT NULL DEFAULT '[]',   -- ordered feature column list

    -- Metadata
    model_date      DATE DEFAULT CURRENT_DATE,      -- when model was trained
    created_at      TIMESTAMPTZ DEFAULT now(),

    UNIQUE(borough_slug, property_type)
);

-- Fast lookup by borough + type (the only query pattern)
CREATE INDEX IF NOT EXISTS idx_lr_coefficients_lookup
    ON lr_model_coefficients (borough_slug, property_type);

-- RLS: read-only for authenticated users, service role can insert/update
ALTER TABLE lr_model_coefficients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lr_coefficients_read" ON lr_model_coefficients
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "lr_coefficients_service" ON lr_model_coefficients
    FOR ALL TO service_role USING (true) WITH CHECK (true);
