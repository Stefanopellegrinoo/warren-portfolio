-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 012: TRULY atomic batch import - NO SAVEPOINTS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CRITICAL BUG FIX #2:
--   Migration 011 still had a BEGIN...EXCEPTION block for type casting.
--   This creates an IMPLICIT SAVEPOINT which allows partial commits.
--
-- ROOT CAUSE:
--   PL/pgSQL treats BEGIN...EXCEPTION as a sub-transaction (savepoint).
--   When line 3 fails, only that savepoint rolls back, NOT lines 1-2.
--
-- SOLUTION:
--   Remove ALL BEGIN...EXCEPTION blocks from the loop.
--   Use regex validation + explicit casts without exception handling.
--   Let Postgres cast errors propagate naturally to the outer EXCEPTION.
--
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop old version
DROP FUNCTION IF EXISTS import_transactions_atomic(UUID, JSONB);

-- Create truly atomic version with ZERO savepoints
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
    -- FAIL-FAST VALIDATION: Check ALL fields BEFORE any INSERT
    -- NO BEGIN...EXCEPTION blocks = NO savepoints = TRUE atomicity
    -- ═══════════════════════════════════════════════════════════════════════
    
    -- Validate DATE field exists
    IF v_transaction->>'date' IS NULL OR v_transaction->>'date' = '' THEN
      RAISE EXCEPTION 'Line %: Missing DATE field', v_line_number;
    END IF;
    
    -- Validate TICKER field exists
    IF v_transaction->>'ticker' IS NULL OR TRIM(v_transaction->>'ticker') = '' THEN
      RAISE EXCEPTION 'Line %: Missing TICKER field', v_line_number;
    END IF;
    
    -- Validate OPERATION field exists
    IF v_transaction->>'operation' IS NULL OR v_transaction->>'operation' = '' THEN
      RAISE EXCEPTION 'Line %: Missing OPERATION field', v_line_number;
    END IF;
    
    -- Validate QUANTITY field exists
    IF v_transaction->>'quantity' IS NULL OR v_transaction->>'quantity' = '' THEN
      RAISE EXCEPTION 'Line %: Missing QUANTITY field', v_line_number;
    END IF;
    
    -- Validate PRICE field exists
    IF v_transaction->>'price' IS NULL OR v_transaction->>'price' = '' THEN
      RAISE EXCEPTION 'Line %: Missing PRICE field', v_line_number;
    END IF;
    
    -- Validate OPERATION type (must be COMPRA or VENTA)
    v_operation := UPPER(TRIM(v_transaction->>'operation'));
    IF v_operation NOT IN ('COMPRA', 'VENTA') THEN
      RAISE EXCEPTION 'Line %: Invalid operation type "%". Must be COMPRA or VENTA', 
        v_line_number, 
        v_operation;
    END IF;
    
    -- ═══════════════════════════════════════════════════════════════════════
    -- CRITICAL: Direct cast WITHOUT BEGIN...EXCEPTION (no savepoint)
    -- If cast fails, error propagates to outer EXCEPTION → full rollback
    -- ═══════════════════════════════════════════════════════════════════════
    
    -- Cast to proper types (will raise exception if invalid, triggering full rollback)
    v_date := (v_transaction->>'date')::DATE;
    v_quantity := (v_transaction->>'quantity')::NUMERIC;
    v_price := (v_transaction->>'price')::NUMERIC;
    v_commission := COALESCE((v_transaction->>'commission')::NUMERIC, 0);
    
    -- Validate quantity and price are positive
    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'Line %: QUANTITY must be greater than 0 (got: %)', 
        v_line_number, 
        v_quantity;
    END IF;
    
    IF v_price <= 0 THEN
      RAISE EXCEPTION 'Line %: PRICE must be greater than 0 (got: %)', 
        v_line_number, 
        v_price;
    END IF;
    
    -- ═══════════════════════════════════════════════════════════════════════
    -- ALL VALIDATIONS PASSED: Safe to insert
    -- ═══════════════════════════════════════════════════════════════════════
    
    v_ticker := UPPER(TRIM(v_transaction->>'ticker'));
    
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
      0, -- avg_cost_after will be recalculated by rebuild
      COALESCE(UPPER(v_transaction->>'assetType'), 'ACCION'),
      COALESCE(UPPER(v_transaction->>'moneda'), 'USD')
    )
    RETURNING id INTO v_inserted_tx_id;
    
    -- Calculate cash movement type and amount
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
  -- SUCCESS: All transactions validated and inserted
  -- ═══════════════════════════════════════════════════════════════════════
  
  RETURN QUERY SELECT 
    TRUE AS success,
    v_imported_count AS imported,
    0 AS failed,
    '[]'::JSONB AS error_details;

EXCEPTION
  WHEN OTHERS THEN
    -- Any error triggers automatic rollback of ALL inserts
    -- Parse error message to extract line number and details
    DECLARE
      v_error_message TEXT := SQLERRM;
      v_line_match TEXT[];
      v_parsed_line INTEGER := 0;
      v_parsed_error TEXT := v_error_message;
    BEGIN
      -- Try to extract "Line N:" from error message
      v_line_match := regexp_matches(v_error_message, 'Line (\d+):', 'i');
      IF array_length(v_line_match, 1) > 0 THEN
        v_parsed_line := v_line_match[1]::INTEGER;
        v_parsed_error := regexp_replace(v_error_message, 'Line \d+:\s*', '', 'i');
      END IF;
      
      -- Return error details with line number
      RETURN QUERY SELECT 
        FALSE AS success,
        0 AS imported,
        1 AS failed,
        jsonb_build_array(
          jsonb_build_object(
            'line', v_parsed_line,
            'ticker', 'UNKNOWN',
            'error', v_parsed_error
          )
        ) AS error_details;
    END;
END;
$$;

-- Add helpful comment
COMMENT ON FUNCTION import_transactions_atomic(UUID, JSONB) IS 
'Atomically imports a batch of transactions with ZERO savepoints. Any error immediately aborts the entire batch (true atomicity).';
