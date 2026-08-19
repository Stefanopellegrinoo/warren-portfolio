-- Migration: 026_price_alerts
-- Standalone TradingView-style price alerts (not tied to strategies)

CREATE TABLE price_alerts (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker        TEXT        NOT NULL,
  type          TEXT        NOT NULL DEFAULT 'price'
                            CHECK (type IN ('price', 'rsi', 'ema20', 'ema50', 'macd_signal')),
  operator      TEXT        NOT NULL
                            CHECK (operator IN ('crosses_above', 'crosses_below')),
  value         NUMERIC     NOT NULL,
  name          TEXT        NOT NULL,
  channel       TEXT        NOT NULL DEFAULT 'telegram',
  status        TEXT        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'triggered')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  triggered_at  TIMESTAMPTZ
);

-- RLS
ALTER TABLE price_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users own their alerts"
  ON price_alerts FOR ALL USING (auth.uid() = user_id);

-- Index for worker evaluation (fetch active alerts by ticker)
CREATE INDEX ON price_alerts(user_id, ticker, status);
