-- Migration 032: ticker identity catalog
--
-- A ticker was accepted as any non-empty string and handed straight to Yahoo
-- Finance. When the string matched an unrelated real symbol, Yahoo returned a
-- well-formed price for the wrong company and nothing flagged it: `UN` resolved
-- to "Corgi UNH 2x Daily ETF", valuing 1769 units at $44,271 against a $25,294
-- cost basis — a fabricated +$18,977 on 10.5% of that portfolio.
--
-- This table records, per ticker, WHICH instrument a human confirmed it to be.
-- Global rather than per-user: what AAPL *is* does not depend on who holds it.
-- Same shape as the `ons` catalog — public read, service-role write, no
-- `version` column because there is no concurrent per-user mutation to guard.

CREATE TABLE IF NOT EXISTS ticker_identity (
  ticker          TEXT PRIMARY KEY,
  yahoo_symbol    TEXT NOT NULL,
  confirmed_name  TEXT NOT NULL,
  exchange        TEXT,
  confirmed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_checked_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ticker_identity ENABLE ROW LEVEL SECURITY;

-- Authenticated users read the catalog; only the service role writes it.
DROP POLICY IF EXISTS "ticker_identity_read" ON ticker_identity;
CREATE POLICY "ticker_identity_read"
  ON ticker_identity FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "ticker_identity_service_write" ON ticker_identity;
CREATE POLICY "ticker_identity_service_write"
  ON ticker_identity FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Seed: every stock ticker open across the two real accounts as of 2026-07-27,
-- each resolved against Yahoo `longName` and checked by hand in that session.
-- Seeding from a fresh automated Yahoo call would record Yahoo's opinion as if
-- it were human confirmation, which is exactly the failure this table prevents.
INSERT INTO ticker_identity (ticker, yahoo_symbol, confirmed_name, exchange) VALUES
  ('AMZN',  'AMZN',  'Amazon.com, Inc.',                      'NasdaqGS'),
  ('AVGO',  'AVGO',  'Broadcom Inc.',                         'NasdaqGS'),
  ('ETHA',  'ETHA',  'iShares Ethereum Trust ETF',            'NasdaqGM'),
  ('EWZ',   'EWZ',   'iShares MSCI Brazil ETF',               'NYSEArca'),
  ('FXI',   'FXI',   'iShares China Large-Cap ETF',           'NYSEArca'),
  ('GOOGL', 'GOOGL', 'Alphabet Inc.',                         'NasdaqGS'),
  ('IBIT',  'IBIT',  'iShares Bitcoin Trust ETF',             'NasdaqGM'),
  ('JD',    'JD',    'JD.com, Inc.',                          'NasdaqGS'),
  ('MELI',  'MELI',  'MercadoLibre, Inc.',                    'NasdaqGS'),
  ('META',  'META',  'Meta Platforms, Inc.',                  'NasdaqGS'),
  ('MSFT',  'MSFT',  'Microsoft Corporation',                 'NasdaqGS'),
  ('NU',    'NU',    'Nu Holdings Ltd.',                      'NYSE'),
  ('NVDA',  'NVDA',  'NVIDIA Corporation',                    'NasdaqGS'),
  ('QQQ',   'QQQ',   'Invesco QQQ Trust',                     'NasdaqGM'),
  ('SPY',   'SPY',   'State Street SPDR S&P 500 ETF Trust',   'NYSEArca'),
  ('STNE',  'STNE',  'StoneCo Ltd.',                          'NasdaqGS'),
  ('TSLA',  'TSLA',  'Tesla, Inc.',                           'NasdaqGS'),
  ('VST',   'VST',   'Vistra Corp.',                          'NYSE')
ON CONFLICT (ticker) DO NOTHING;

COMMENT ON TABLE ticker_identity IS 'Human-confirmed instrument behind each ticker string. Prevents a mistyped ticker from being priced as an unrelated company.';
COMMENT ON COLUMN ticker_identity.yahoo_symbol IS 'Result of normalizeTickerForYahoo(ticker) — e.g. BCBA:GGAL becomes GGAL.BA.';
COMMENT ON COLUMN ticker_identity.confirmed_name IS 'Yahoo longName at confirmation time. The audit job compares against this and never overwrites it.';
COMMENT ON COLUMN ticker_identity.last_checked_at IS 'Last time the audit job verified this row still matches.';
