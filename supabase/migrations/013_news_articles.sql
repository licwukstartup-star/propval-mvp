-- ROLLBACK:
--   DROP TABLE IF EXISTS macro_indicators;
--   DROP TABLE IF EXISTS news_articles;

-- News articles aggregated from RSS feeds (public market intelligence — shared read-only)
CREATE TABLE IF NOT EXISTS news_articles (
    id            UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
    title         TEXT          NOT NULL,
    summary       TEXT,
    url           TEXT          UNIQUE NOT NULL,
    source_name   TEXT          NOT NULL,
    category      TEXT          NOT NULL CHECK (category IN ('property', 'rics', 'macro')),
    topic_tag     TEXT,
    published_at  TIMESTAMPTZ,
    fetched_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_articles_category    ON news_articles (category);
CREATE INDEX IF NOT EXISTS idx_news_articles_published   ON news_articles (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_articles_fetched     ON news_articles (fetched_at DESC);

-- RLS: authenticated users can read; backend (service role) can write
ALTER TABLE news_articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read news articles" ON news_articles;
CREATE POLICY "Authenticated users can read news articles"
    ON news_articles FOR SELECT
    USING (auth.role() = 'authenticated');

-- Macro indicator values updated by the refresh job
CREATE TABLE IF NOT EXISTS macro_indicators (
    id             UUID   DEFAULT gen_random_uuid() PRIMARY KEY,
    indicator_key  TEXT   UNIQUE NOT NULL,
    label          TEXT   NOT NULL,
    value          TEXT   NOT NULL,
    change_amount  TEXT,
    direction      TEXT   CHECK (direction IN ('up', 'down', 'neutral')) DEFAULT 'neutral',
    last_updated   DATE,
    updated_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE macro_indicators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read macro indicators" ON macro_indicators;
CREATE POLICY "Authenticated users can read macro indicators"
    ON macro_indicators FOR SELECT
    USING (auth.role() = 'authenticated');

-- Seed macro indicators with current values (as of March 2026)
INSERT INTO macro_indicators (indicator_key, label, value, change_amount, direction, last_updated)
VALUES
    ('base_rate',       'Base Rate',       '4.25%',  '−0.25%', 'down',    '2025-11-07'),
    ('cpi',             'CPI',             '2.6%',   '+0.1%',  'up',      '2025-10-16'),
    ('avg_house_price', 'Avg House Price', '£298k',  '+£2.1k', 'up',      '2025-09-25'),
    ('gdp_growth',      'GDP Growth',      '0.3%',   '+0.2%',  'up',      '2025-10-11'),
    ('gilt_10y',        '10Y Gilt',        '4.48%',  '+0.12%', 'up',      '2026-03-11'),
    ('unemployment',    'Unemployment',    '4.1%',   '—',      'neutral', '2025-10-15')
ON CONFLICT (indicator_key) DO NOTHING;
