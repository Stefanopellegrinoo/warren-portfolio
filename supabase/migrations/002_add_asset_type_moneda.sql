-- Add missing columns to transactions table
ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS asset_type text DEFAULT 'ACCION',
ADD COLUMN IF NOT EXISTS moneda text DEFAULT 'USD';

-- Update existing rows if necessary
UPDATE transactions SET asset_type = 'ACCION' WHERE asset_type IS NULL;
UPDATE transactions SET moneda = 'USD' WHERE moneda IS NULL;
