-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 009: Backfill cash_movements for existing transactions
-- ═══════════════════════════════════════════════════════════════════════════
--
-- PURPOSE:
--   Creates missing cash_movements for historical transactions (COMPRA/VENTA).
--   This ensures that when users delete or edit old transactions, cash balance
--   updates correctly through the new referential integrity system.
--
-- SAFETY:
--   - Only processes COMPRA/VENTA transactions (not CUPON/DIVIDENDO)
--   - Skips transactions that already have a cash_movement linked
--   - Uses transaction existence check instead of ON CONFLICT (no unique constraint)
--   - Logs how many records were backfilled
--
-- ═══════════════════════════════════════════════════════════════════════════

-- Simple INSERT without ON CONFLICT (transaction_id is nullable, no unique constraint)
INSERT INTO cash_movements (
  user_id,
  date,
  type,
  amount,
  description,
  ticker,
  transaction_id,
  created_at
)
SELECT 
  t.user_id,
  t.date,
  CASE 
    WHEN t.operation = 'COMPRA' THEN 'RETIRO'
    WHEN t.operation = 'VENTA' THEN 'DEPOSITO'
  END AS type,
  CASE 
    WHEN t.operation = 'COMPRA' THEN 
      (ABS(t.quantity) * t.price) + COALESCE(t.commission, 0)
    WHEN t.operation = 'VENTA' THEN 
      (ABS(t.quantity) * t.price) - COALESCE(t.commission, 0)
  END AS amount,
  t.operation || ' ' || t.ticker || ' - ' || ABS(t.quantity) || ' @ ' || t.price AS description,
  t.ticker,
  t.id AS transaction_id,
  NOW() AS created_at
FROM transactions t
WHERE t.operation IN ('COMPRA', 'VENTA')
  AND NOT EXISTS (
    SELECT 1 FROM cash_movements cm 
    WHERE cm.transaction_id = t.id
  );

-- Log the number of records inserted
DO $$
DECLARE
  inserted_count INTEGER;
BEGIN
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RAISE NOTICE 'Backfilled % cash_movements for historical transactions', inserted_count;
END $$;