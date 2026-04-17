-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 008: Link cash_movements to transactions
-- ═══════════════════════════════════════════════════════════════════════════
--
-- PURPOSE:
--   Establish referential integrity between cash_movements and transactions.
--   When a COMPRA/VENTA transaction is created, it generates a cash_movement.
--   When the transaction is deleted or updated, the cash_movement must be 
--   deleted or updated accordingly.
--
-- CHANGES:
--   1. Add transaction_id column (nullable, for backward compatibility)
--   2. Add foreign key with ON DELETE CASCADE
--   3. Add index for performance
--
-- BACKWARD COMPATIBILITY:
--   - Existing cash_movements without transaction_id remain valid
--   - CUPON and DIVIDENDO movements will continue to have NULL transaction_id
--   - Only RETIRO/DEPOSITO from COMPRA/VENTA will have transaction_id
--
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Add transaction_id column (nullable for existing data)
ALTER TABLE cash_movements 
ADD COLUMN transaction_id UUID NULL;

-- 2. Add foreign key with CASCADE delete
--    When a transaction is deleted, its associated cash_movement is deleted too
ALTER TABLE cash_movements
ADD CONSTRAINT fk_cash_movements_transaction
FOREIGN KEY (transaction_id) 
REFERENCES transactions(id) 
ON DELETE CASCADE;

-- 3. Create index for performance (lookup cash_movements by transaction_id)
CREATE INDEX idx_cash_movements_transaction_id 
ON cash_movements(transaction_id) 
WHERE transaction_id IS NOT NULL;

-- 4. Add comment for documentation
COMMENT ON COLUMN cash_movements.transaction_id IS 
'Links cash movement to its originating transaction (COMPRA/VENTA). NULL for manual deposits/withdrawals and CUPON/DIVIDENDO.';
