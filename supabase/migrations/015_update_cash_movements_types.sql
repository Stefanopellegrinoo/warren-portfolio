-- Migration 015: Expand cash_movements types to include COMPRA/VENTA
-- This allows the RPC to record stock purchases and sales in the cash ledger.

ALTER TABLE cash_movements 
DROP CONSTRAINT IF EXISTS cash_movements_type_check;

ALTER TABLE cash_movements 
ADD CONSTRAINT cash_movements_type_check 
CHECK (type IN ('DEPOSITO', 'RETIRO', 'CUPON', 'DIVIDENDO', 'COMPRA', 'VENTA'));
