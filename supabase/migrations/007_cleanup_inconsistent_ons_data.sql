-- Data cleanup script for ons foreign key migration
-- RUN THIS BEFORE running 007_add_ons_foreign_keys.sql
-- This script identifies and optionally fixes inconsistent data

-- 1. First, identify all transactions with asset_type='ON' that don't have matching ons
SELECT 
  'transactions' as table_name,
  COUNT(*) as invalid_count,
  ARRAY_AGG(DISTINCT ticker) as missing_tickers
FROM transactions 
WHERE asset_type = 'ON' 
  AND ticker NOT IN (SELECT ticker FROM ons)
UNION ALL
-- 2. Identify on_positions without matching ons
SELECT 
  'on_positions' as table_name,
  COUNT(*) as invalid_count,
  ARRAY_AGG(DISTINCT ticker) as missing_tickers
FROM on_positions 
WHERE ticker NOT IN (SELECT ticker FROM ons)
UNION ALL
-- 3. Identify on_trades without matching ons (if table exists)
SELECT 
  'on_trades' as table_name,
  COALESCE(COUNT(*), 0) as invalid_count,
  COALESCE(ARRAY_AGG(DISTINCT ticker), ARRAY[]::TEXT[]) as missing_tickers
FROM information_schema.tables t
LEFT JOIN on_trades ot ON 1=1
WHERE t.table_name = 'on_trades'
  AND t.table_schema = 'public'
  AND ot.ticker NOT IN (SELECT ticker FROM ons)
GROUP BY t.table_name;

-- ==============================================
-- OPTION 1: AUTO-FIX by inserting missing ons (recommended)
-- ==============================================

-- Insert missing ons for transactions
INSERT INTO ons (ticker, name, currency, created_at)
SELECT DISTINCT 
  t.ticker,
  'Unknown bond - auto-inserted during cleanup' as name,
  'USD' as currency,
  NOW() as created_at
FROM transactions t
WHERE t.asset_type = 'ON' 
  AND t.ticker NOT IN (SELECT ticker FROM ons)
ON CONFLICT (ticker) DO NOTHING;

-- Insert missing ons for on_positions
INSERT INTO ons (ticker, name, currency, created_at)
SELECT DISTINCT 
  op.ticker,
  'Unknown bond - auto-inserted during cleanup' as name,
  'USD' as currency,
  NOW() as created_at
FROM on_positions op
WHERE op.ticker NOT IN (SELECT ticker FROM ons)
ON CONFLICT (ticker) DO NOTHING;

-- Insert missing ons for on_trades (if table exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'on_trades'
  ) THEN
    INSERT INTO ons (ticker, name, currency, created_at)
    SELECT DISTINCT 
      ot.ticker,
      'Unknown bond - auto-inserted during cleanup' as name,
      'USD' as currency,
      NOW() as created_at
    FROM on_trades ot
    WHERE ot.ticker NOT IN (SELECT ticker FROM ons)
    ON CONFLICT (ticker) DO NOTHING;
  END IF;
END $$;

-- ==============================================
-- OPTION 2: MANUAL cleanup (if you want to delete invalid data)
-- ==============================================

-- WARNING: These DELETE statements remove data permanently!
-- Uncomment only if you want to delete inconsistent data instead of inserting ons

-- Delete transactions with invalid ON tickers
-- DELETE FROM transactions 
-- WHERE asset_type = 'ON' 
--   AND ticker NOT IN (SELECT ticker FROM ons);

-- Delete on_positions with invalid tickers  
-- DELETE FROM on_positions 
-- WHERE ticker NOT IN (SELECT ticker FROM ons);

-- Delete on_trades with invalid tickers (if table exists)
-- DO $$
-- BEGIN
--   IF EXISTS (
--     SELECT FROM information_schema.tables 
--     WHERE table_schema = 'public' AND table_name = 'on_trades'
--   ) THEN
--     DELETE FROM on_trades 
--     WHERE ticker NOT IN (SELECT ticker FROM ons);
--   END IF;
-- END $$;

-- ==============================================
-- FINAL VERIFICATION
-- ==============================================

-- After running either option, verify no inconsistent data remains
DO $$
DECLARE
  remaining_invalid INTEGER := 0;
BEGIN
  -- Check transactions
  SELECT COUNT(*) INTO remaining_invalid
  FROM transactions 
  WHERE asset_type = 'ON' 
    AND ticker NOT IN (SELECT ticker FROM ons);

  -- Check on_positions
  SELECT remaining_invalid + COUNT(*) INTO remaining_invalid
  FROM on_positions 
  WHERE ticker NOT IN (SELECT ticker FROM ons);

  -- Check on_trades
  IF EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'on_trades'
  ) THEN
    SELECT remaining_invalid + COUNT(*) INTO remaining_invalid
    FROM on_trades 
    WHERE ticker NOT IN (SELECT ticker FROM ons);
  END IF;

  IF remaining_invalid = 0 THEN
    RAISE NOTICE '✅ All data is consistent. Safe to add foreign keys.';
    RAISE NOTICE 'Run: psql -f 007_add_ons_foreign_keys.sql';
  ELSE
    RAISE WARNING '❌ Still have % inconsistent records. Fix before adding FKs.', remaining_invalid;
  END IF;
END $$;