-- Migration 037: on_price_history
--
-- Daily close per corporate-bond ticker (Data912 `arg_corp`, Dollar-MEP rows).
-- Data912 only serves "now", so an ON's price history cannot be rebuilt after
-- the fact: every night not captured is lost. The nightly SNAPSHOT_JOB upserts
-- the WHOLE D-suffixed feed here, keyed by the Argentine calendar day.
--
-- Global, not per-user: a bond's close does not depend on who holds it, and
-- there is no FK to `ons` on purpose (the feed is captured whole, not only
-- the tickers someone happens to hold today).
--
-- `close` is the raw quoted `c` (same units price-worker feeds as Quote.price;
-- value = close/100 x nominal). Same RLS shape as `ons` and `ticker_identity`:
-- public read, service-role write.

CREATE TABLE IF NOT EXISTS on_price_history (
  ticker      TEXT NOT NULL,
  price_date  DATE NOT NULL,
  close       NUMERIC(14,4) NOT NULL CHECK (close > 0),
  bid         NUMERIC(14,4),
  ask         NUMERIC(14,4),
  volume      NUMERIC(20,2),
  pct_change  NUMERIC(10,4),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source      TEXT NOT NULL DEFAULT 'data912',
  PRIMARY KEY (ticker, price_date)
);

ALTER TABLE on_price_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "on_price_history_read_all" ON on_price_history;
CREATE POLICY "on_price_history_read_all"
  ON on_price_history FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "on_price_history_modify_service" ON on_price_history;
CREATE POLICY "on_price_history_modify_service"
  ON on_price_history FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
