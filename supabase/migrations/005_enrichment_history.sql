-- Archive table for tracking changes to enrichment data over time.
-- When a source like EPC is updated with new data, the old row is
-- archived here before being overwritten in property_enrichment.

CREATE TABLE property_enrichment_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uprn            TEXT NOT NULL,
    data_source     TEXT NOT NULL,
    payload         JSONB NOT NULL,
    fetched_at      TIMESTAMPTZ NOT NULL,       -- when this version was originally fetched
    archived_at     TIMESTAMPTZ DEFAULT NOW()    -- when it was superseded
);

CREATE INDEX idx_enrichment_history_uprn ON property_enrichment_history(uprn);
CREATE INDEX idx_enrichment_history_source ON property_enrichment_history(uprn, data_source);

ALTER TABLE property_enrichment_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read enrichment history"
    ON property_enrichment_history FOR SELECT
    USING (auth.role() = 'authenticated');
