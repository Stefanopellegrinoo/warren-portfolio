-- Migration 006 (SAFE): Create ons table for corporate bonds tracking
-- Tickers from data912.com (AER9O, BACGD, etc.)
-- SAFER VERSION: No foreign keys with WHERE clauses (PostgreSQL doesn't support conditional FKs)
-- We'll add proper referential integrity later after data cleanup

-- Drop the problematic migration if it exists
DROP TABLE IF EXISTS ons CASCADE;

CREATE TABLE ons (
  ticker TEXT PRIMARY KEY,
  name TEXT,
  maturity_date DATE,
  currency TEXT DEFAULT 'USD',
  last_price DECIMAL(12,2),
  last_updated TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add RLS policies
ALTER TABLE ons ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read ons (public info)
CREATE POLICY "ons_read_all" ON ons
  FOR SELECT USING (true);

-- Policy: Only service role can insert/update ons (via backend)
CREATE POLICY "ons_modify_service" ON ons
  FOR ALL USING (auth.role() = 'service_role');

-- Index for faster lookups (already implicit via PRIMARY KEY, but we add for consistency)
CREATE INDEX IF NOT EXISTS idx_ons_ticker_lookup ON ons(ticker);

-- IMPORTANT: We are NOT adding foreign key constraints here because:
-- 1. PostgreSQL doesn't support conditional FKs (WHERE clause)
-- 2. Existing data may not have matching ons entries
-- 3. We'll add CHECK constraints and application-level validation instead

-- CHECK constraints for data quality
ALTER TABLE ons 
ADD CONSTRAINT check_ticker_format 
CHECK (ticker ~ '^[A-Z0-9]+$');

ALTER TABLE ons 
ADD CONSTRAINT check_currency_valid 
CHECK (currency IN ('USD', 'ARS'));

ALTER TABLE ons 
ADD CONSTRAINT check_price_positive 
CHECK (last_price IS NULL OR last_price >= 0);

-- Comments for documentation
COMMENT ON TABLE ons IS 'Corporate bonds (ONs) from data912.com that users are trading. No foreign keys yet to avoid migration failures.';
COMMENT ON COLUMN ons.ticker IS 'Ticker symbol (e.g., AER9O, BACGD) - uppercase alphanumeric';
COMMENT ON COLUMN ons.name IS 'Full name of the bond';
COMMENT ON COLUMN ons.maturity_date IS 'Maturity date when available';
COMMENT ON COLUMN ons.currency IS 'Currency (USD/ARS)';
COMMENT ON COLUMN ons.last_price IS 'Last known price from data912.com';
COMMENT ON COLUMN ons.last_updated IS 'When the price was last updated';
COMMENT ON COLUMN ons.created_at IS 'When this bond was added to the system';

-- NO INSERTs here - data will be populated via backend/search endpoint