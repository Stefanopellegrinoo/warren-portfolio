-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 013: Simplified atomic import - NO nested blocks AT ALL
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ULTIMATE SIMPLICITY: Remove even the nested BEGIN inside EXCEPTION handler
--
-- This version has:
-- - NO BEGIN...EXCEPTION blocks inside loops (prevents savepoints)
-- - NO nested DECLARE...BEGIN inside EXCEPTION handler (cleaner)
-- - Direct RAISE EXCEPTION on any validation failure
-- - Simple error return without regex parsing
--
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop old version
DROP FUNCTION IF EXISTS import_transactions_atomic(UUID, JSONB);

-- Create ultimate simplified version
CREATE OR REPLACE FUNCTION import_transactions_atomic(
  p_user_id UUID,
  p_transactions JSONB
)
RETURNS TABLE(
  success BOOLEAN,
  imported INTEGER,
  failed INTEGER,
  error_details JSONB
) 
LANGUAGE plpgsql
AS $$
DECLARE
  v_transaction JSONB;
  v_line_number INTEGER := 0;
  v_inserted_tx_id UUID;
  v_imported_count INTEGER := 0;
  v_cash_type TEXT;
  v_cash_amount NUMERIC;
  v_operation TEXT;
  v_ticker TEXT;
  v_quantity NUMERIC;
  v_price NUMERIC;
  v_date DATE;
  v_commission NUMERIC;
BEGIN
  -- Loop through each transaction in the batch
  FOR v_transaction IN SELECT * FROM jsonb_array_elements(p_transactions)
  LOOP
    v_line_number := v_line_number + 1;
    
    -- ═══════════════════════════════════════════════════════════════════════
    -- FAIL-FAST VALIDATION: Any error → RAISE EXCEPTION → full rollback
    -- ═══════════════════════════════════════════════════════════════════════
    
    -- Validate DATE field exists
    IF v_transaction->>'date' IS NULL OR v_transaction->>'date' = '' THEN
      RAISE EXCEPTION 'Line %: Missing DATE field', v_line_number;
    END IF;
    
    -- Validate TICKER field exists
    v_ticker := UPPER(TRIM(v_transaction->>'ticker'));
    IF v_ticker = '' THEN
      RAISE EXCEPTION 'Line %: Missing TICKER field', v_line_number;
    END IF;
    
    -- Validate OPERATION field exists
    v_operation := UPPER(TRIM(v_transaction->>'operation'));
    IF v_operation = '' THEN
      RAISE EXCEPTION 'Line %: Missing OPERATION field', v_line_number;
    END IF;
    
    -- Validate OPERATION type
    IF v_operation NOT IN ('COMPRA', 'VENTA', 'DIVIDENDO') THEN
      RAISE EXCEPTION 'Line %: Invalid operation type "%". Must be COMPRA, VENTA or DIVIDENDO', 
        v_line_number, v_operation;
    END IF;
    
    -- Validate QUANTITY field exists
    IF v_transaction->>'quantity' IS NULL OR v_transaction->>'quantity' = '' THEN
      RAISE EXCEPTION 'Line %: Missing QUANTITY field', v_line_number;
    END IF;
    
    -- Validate PRICE field exists
    IF v_transaction->>'price' IS NULL OR v_transaction->>'price' = '' THEN
      RAISE EXCEPTION 'Line %: Missing PRICE field', v_line_number;
    END IF;
    
    -- ═══════════════════════════════════════════════════════════════════════
    -- Direct casts (will raise exception if invalid → full rollback)
    -- ═══════════════════════════════════════════════════════════════════════
    v_date := (v_transaction->>'date')::DATE;
    v_quantity := (v_transaction->>'quantity')::NUMERIC;
    v_price := (v_transaction->>'price')::NUMERIC;
    v_commission := COALESCE((v_transaction->>'commission')::NUMERIC, 0);
    
    -- Validate quantity and price are positive
    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'Line %: QUANTITY must be greater than 0 (got: %)', 
        v_line_number, v_quantity;
    END IF;
    
    IF v_price <= 0 THEN
      RAISE EXCEPTION 'Line %: PRICE must be greater than 0 (got: %)', 
        v_line_number, v_price;
    END IF;
    
    -- ═══════════════════════════════════════════════════════════════════════
    -- ALL VALIDATIONS PASSED: Insert transaction + cash movement
    -- ═══════════════════════════════════════════════════════════════════════
    
    -- Insert transaction
    INSERT INTO transactions (
      user_id,
      date,
      ticker,
      operation,
      quantity,
      price,
      commission,
      notes,
      avg_cost_after,
      asset_type,
      moneda
    ) VALUES (
      p_user_id,
      v_date,
      v_ticker,
      v_operation,
      CASE 
        WHEN v_operation = 'VENTA' THEN -ABS(v_quantity)
        ELSE ABS(v_quantity)
      END,
      v_price,
      v_commission,
      v_transaction->>'notes',
      0,
      COALESCE(UPPER(v_transaction->>'assetType'), 'ACCION'),
      COALESCE(UPPER(v_transaction->>'moneda'), 'USD')
    )
    RETURNING id INTO v_inserted_tx_id;
    
    -- Calculate cash movement
    v_cash_type := CASE 
      WHEN v_operation = 'COMPRA' THEN 'RETIRO'
      WHEN v_operation = 'VENTA' THEN 'DEPOSITO'
    END;
    
    v_cash_amount := CASE 
      WHEN v_operation = 'COMPRA' THEN
        (ABS(v_quantity) * v_price) + v_commission
      WHEN v_operation = 'VENTA' THEN
        (ABS(v_quantity) * v_price) - v_commission
    END;
    
    -- Insert cash movement linked to transaction
    INSERT INTO cash_movements (
      user_id,
      date,
      type,
      amount,
      description,
      ticker,
      transaction_id,
      created_at
    ) VALUES (
      p_user_id,
      v_date,
      v_cash_type,
      v_cash_amount,
      v_operation || ' ' || v_ticker || ' - ' || 
        ABS(v_quantity) || ' @ ' || v_price,
      v_ticker,
      v_inserted_tx_id,
      NOW()
    );
    
    v_imported_count := v_imported_count + 1;
  END LOOP;
  
  -- ═══════════════════════════════════════════════════════════════════════
  -- SUCCESS: Return results
  -- ═══════════════════════════════════════════════════════════════════════
  RETURN QUERY SELECT 
    TRUE AS success,
    v_imported_count AS imported,
    0 AS failed,
    '[]'::JSONB AS error_details;

EXCEPTION
  WHEN OTHERS THEN
    -- Any error triggers full rollback
    -- Return simple error without complex parsing
    RETURN QUERY SELECT 
      FALSE AS success,
      0 AS imported,
      1 AS failed,
      jsonb_build_array(
        jsonb_build_object(
          'line', v_line_number,
          'ticker', COALESCE(v_ticker, 'UNKNOWN'),
          'error', SQLERRM
        )
      ) AS error_details;
END;
$$;

-- Add helpful comment
COMMENT ON FUNCTION import_transactions_atomic(UUID, JSONB) IS 
'Simplified atomic import. Any validation error immediately aborts entire batch. Guaranteed all-or-nothing.';