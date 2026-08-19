-- Migration 007: Add foreign keys to ons table AFTER data cleanup
-- This should be run ONLY after:
-- 1. ons table is populated with all needed tickers
-- 2. Data cleanup queries below have been run
-- 3. Application has been updated to validate tickers at app level

-- First, let's check for data inconsistencies
DO $$
DECLARE
  missing_ons_count INTEGER;
  on_trades_invalid INTEGER;
  on_positions_invalid INTEGER;
BEGIN
  -- Check transactions with asset_type='ON' that don't have matching ons
  SELECT COUNT(*) INTO missing_ons_count
  FROM transactions 
  WHERE asset_type = 'ON' 
    AND ticker NOT IN (SELECT ticker FROM ons);

  -- Check on_trades (if table exists) without matching ons
  SELECT COUNT(*) INTO on_trades_invalid
  FROM information_schema.tables 
  WHERE table_name = 'on_trades'
    AND table_schema = 'public';

  IF on_trades_invalid > 0 THEN
    SELECT COUNT(*) INTO on_trades_invalid
    FROM on_trades 
    WHERE ticker NOT IN (SELECT ticker FROM ons);
  ELSE
    on_trades_invalid := 0;
  END IF;

  -- Check on_positions without matching ons
  SELECT COUNT(*) INTO on_positions_invalid
  FROM on_positions 
  WHERE ticker NOT IN (SELECT ticker FROM ons);

  RAISE NOTICE 'Data consistency check:';
  RAISE NOTICE '  Transactions with asset_type=''ON'' missing ons: %', missing_ons_count;
  RAISE NOTICE '  on_trades missing ons: %', on_trades_invalid;
  RAISE NOTICE '  on_positions missing ons: %', on_positions_invalid;

  IF missing_ons_count > 0 OR on_trades_invalid > 0 OR on_positions_invalid > 0 THEN
    RAISE WARNING 'Found inconsistent data. Run cleanup queries before adding foreign keys.';
    RAISE WARNING 'See 007_cleanup_inconsistent_ons_data.sql for cleanup queries.';
  END IF;
END $$;

-- IMPORTANT: Uncomment these lines ONLY after running cleanup queries
-- and verifying all data is consistent

-- Add foreign key for on_positions
-- ALTER TABLE on_positions
-- ADD CONSTRAINT fk_on_positions_ticker
-- FOREIGN KEY (ticker)
-- REFERENCES ons(ticker)
-- ON DELETE RESTRICT;

-- Add foreign key for on_trades (if table exists)
-- DO $$
-- BEGIN
--   IF EXISTS (
--     SELECT FROM information_schema.tables 
--     WHERE table_schema = 'public' AND table_name = 'on_trades'
--   ) THEN
--     ALTER TABLE on_trades
--     ADD CONSTRAINT fk_on_trades_ticker
--     FOREIGN KEY (ticker)
--     REFERENCES ons(ticker)
--     ON DELETE RESTRICT;
--   END IF;
-- END $$;

-- Note: We CANNOT add conditional FK for transactions with WHERE clause
-- Instead, we add a CHECK constraint and rely on application validation
ALTER TABLE transactions
ADD CONSTRAINT check_on_ticker_valid 
CHECK (
  (asset_type != 'ON') OR 
  (asset_type = 'ON' AND ticker IN (SELECT ticker FROM ons))
);

-- Add comment explaining the approach
COMMENT ON CONSTRAINT check_on_ticker_valid ON transactions IS 
'For asset_type=''ON'', ticker must exist in ons table. 
Enforced via CHECK constraint since PostgreSQL doesn''t support conditional FKs.';