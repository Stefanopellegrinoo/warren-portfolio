-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 019: Replace portfolio atomic
-- ═══════════════════════════════════════════════════════════════════════════
-- This function deletes ALL existing data for a user and re-imports
-- everything from a JSON array in a single transaction.
-- If any part fails, everything is rolled back to the original state.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION replace_portfolio_atomic(
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
  -- 1. SECURITY VALIDATION
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: User ID is required';
  END IF;

  -- 2. MASSIVE DELETE (Ordered for foreign keys)
  -- Deleting children first to satisfy referential integrity
  DELETE FROM closed_trades WHERE user_id = p_user_id;
  DELETE FROM on_closed_trades WHERE user_id = p_user_id;
  DELETE FROM positions WHERE user_id = p_user_id;
  DELETE FROM on_positions WHERE user_id = p_user_id;
  DELETE FROM cash_movements WHERE user_id = p_user_id;
  DELETE FROM transactions WHERE user_id = p_user_id;
  
  -- Reset cash balance
  UPDATE cash_balance SET balance = 0, version = version + 1 WHERE user_id = p_user_id;

  -- 3. IMPORT LOOP (Logic consistent with migration 018)
  FOR v_transaction IN SELECT * FROM jsonb_array_elements(p_transactions)
  LOOP
    v_line_number := v_line_number + 1;
    
    -- Basic validation of required fields
    v_ticker := UPPER(TRIM(v_transaction->>'ticker'));
    v_operation := UPPER(TRIM(v_transaction->>'operation'));
    
    IF v_transaction->>'date' IS NULL OR v_transaction->>'date' = '' THEN
      RAISE EXCEPTION 'Line %: Missing DATE field', v_line_number;
    END IF;
    
    IF v_ticker = '' THEN
      RAISE EXCEPTION 'Line %: Missing TICKER field', v_line_number;
    END IF;
    
    IF v_operation = '' THEN
      RAISE EXCEPTION 'Line %: Missing OPERATION field', v_line_number;
    END IF;
    
    -- Operation type validation
    IF v_operation NOT IN ('COMPRA', 'VENTA', 'DIVIDENDO', 'CUPON') THEN
      RAISE EXCEPTION 'Line %: Invalid operation type "%". Must be COMPRA, VENTA, DIVIDENDO or CUPON', 
        v_line_number, v_operation;
    END IF;
    
    -- Cast values (Postgres will throw error if invalid format)
    v_date := (v_transaction->>'date')::DATE;
    v_quantity := (v_transaction->>'quantity')::NUMERIC;
    v_price := (v_transaction->>'price')::NUMERIC;
    v_commission := COALESCE((v_transaction->>'commission')::NUMERIC, 0);
    
    -- Positivity validation
    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'Line %: QUANTITY must be greater than 0', v_line_number;
    END IF;
    IF v_price <= 0 THEN
      RAISE EXCEPTION 'Line %: PRICE must be greater than 0', v_line_number;
    END IF;
    
    -- Insert Transaction
    INSERT INTO transactions (
      user_id, date, ticker, operation, quantity, price, commission, 
      notes, avg_cost_after, asset_type, moneda
    ) VALUES (
      p_user_id, v_date, v_ticker, v_operation,
      CASE 
        WHEN v_operation = 'VENTA' THEN -ABS(v_quantity)
        ELSE ABS(v_quantity)
      END,
      v_price, v_commission, v_transaction->>'notes', 0,
      COALESCE(UPPER(v_transaction->>'assetType'), 'ACCION'),
      COALESCE(UPPER(v_transaction->>'moneda'), 'USD')
    )
    RETURNING id INTO v_inserted_tx_id;
    
    -- Calculate cash movement
    v_cash_type := CASE 
      WHEN v_operation = 'COMPRA' THEN 'RETIRO'
      WHEN v_operation IN ('VENTA', 'DIVIDENDO', 'CUPON') THEN 'DEPOSITO'
    END;
    
    v_cash_amount := CASE 
      WHEN v_operation = 'COMPRA' THEN (v_quantity * v_price) + v_commission
      WHEN v_operation = 'VENTA' THEN (v_quantity * v_price) - v_commission
      WHEN v_operation IN ('DIVIDENDO', 'CUPON') THEN (v_quantity * v_price)
    END;
    
    -- Insert cash movement linked to transaction
    INSERT INTO cash_movements (
      user_id, date, type, amount, description, ticker, transaction_id, created_at
    ) VALUES (
      p_user_id, v_date, v_cash_type, v_cash_amount,
      v_operation || ' ' || v_ticker || ' - ' || v_quantity || ' @ ' || v_price,
      v_ticker, v_inserted_tx_id, NOW()
    );
    
    v_imported_count := v_imported_count + 1;
  END LOOP;
  
  -- Success return
  RETURN QUERY SELECT TRUE AS success, v_imported_count AS imported, 0 AS failed, '[]'::JSONB AS error_details;

EXCEPTION
  WHEN OTHERS THEN
    -- Any error triggers full rollback of the transaction automatically
    RETURN QUERY SELECT FALSE AS success, 0 AS imported, 1 AS failed, 
      jsonb_build_array(jsonb_build_object('line', v_line_number, 'ticker', COALESCE(v_ticker, 'UNKNOWN'), 'error', SQLERRM)) AS error_details;
END;
$$;

-- Add helpful comment
COMMENT ON FUNCTION replace_portfolio_atomic(UUID, JSONB) IS 
'Atomic replace of entire portfolio. Deletes all user data and re-imports in a single transaction.';
