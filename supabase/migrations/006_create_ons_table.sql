-- Migration 006: Create ons table for corporate bonds tracking
-- Tickers from data912.com (AER9O, BACGD, etc.)

CREATE TABLE IF NOT EXISTS ons (
  ticker TEXT PRIMARY KEY,
  name TEXT,
  maturity_date DATE,
  currency TEXT DEFAULT 'USD',
  last_price DECIMAL(12,2),
  last_updated TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add foreign key constraints to existing tables
-- Note: These may fail if existing data violates constraints

-- transactions table references ons for asset_type='ON'
ALTER TABLE transactions 
ADD CONSTRAINT fk_transactions_on_ticker 
FOREIGN KEY (ticker) 
REFERENCES ons(ticker)
ON DELETE RESTRICT
WHERE asset_type = 'ON';

-- on_positions table references ons
ALTER TABLE on_positions
ADD CONSTRAINT fk_on_positions_ticker
FOREIGN KEY (ticker)
REFERENCES ons(ticker)
ON DELETE RESTRICT;

-- on_trades table references ons  
ALTER TABLE on_trades
ADD CONSTRAINT fk_on_trades_ticker
FOREIGN KEY (ticker)
REFERENCES ons(ticker)
ON DELETE RESTRICT;

-- Add RLS policies
ALTER TABLE ons ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read ons (public info)
CREATE POLICY "ons_read_all" ON ons
  FOR SELECT USING (true);

-- Policy: Only service role can insert/update ons (via backend)
CREATE POLICY "ons_modify_service" ON ons
  FOR ALL USING (auth.role() = 'service_role');

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_ons_ticker_lookup ON ons(ticker);

-- Insert some common corporate bonds initially (optional)
-- These can be populated dynamically as users trade them
INSERT INTO ons (ticker, name, currency, created_at) VALUES
  ('AER9O', 'Aeropuertos Argentina 2000 9% 2025', 'USD', NOW()),
  ('BACGD', 'Banco Galicia 7.5% 2026', 'USD', NOW()),
  ('AFCHD', 'Arcos Dorados 6.875% 2027', 'USD', NOW())
ON CONFLICT (ticker) DO NOTHING;

COMMENT ON TABLE ons IS 'Corporate bonds (ONs) from data912.com that users are trading';
COMMENT ON COLUMN ons.ticker IS 'Ticker symbol (e.g., AER9O, BACGD)';
COMMENT ON COLUMN ons.name IS 'Full name of the bond';
COMMENT ON COLUMN ons.maturity_date IS 'Maturity date when available';
COMMENT ON COLUMN ons.currency IS 'Currency (USD/ARS)';
COMMENT ON COLUMN ons.last_price IS 'Last known price from data912.com';
COMMENT ON COLUMN ons.last_updated IS 'When the price was last updated';
COMMENT ON COLUMN ons.created_at IS 'When this bond was added to the system';