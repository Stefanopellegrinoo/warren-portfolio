-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 010: Atomic transaction batch import with rollback support
-- ═══════════════════════════════════════════════════════════════════════════
--
-- PURPOSE:
--   Provides an atomic batch import function for transactions.
--   If ANY transaction fails validation or insert, the ENTIRE batch is rolled back.
--   This ensures data consistency and prevents partial imports.
--
-- FEATURES:
--   - Atomic operation (all-or-nothing)
--   - Creates transactions + cash_movements in single transaction
--   - Returns detailed error info (line numbers, validation errors)
--   - Supports COMPRA, VENTA operations
--   - Links cash_movements to transactions via transaction_id
--
-- ═══════════════════════════════════════════════════════════════════════════

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
  v_errors JSONB := '[]'::JSONB;
  v_imported_count INTEGER := 0;
  v_failed_count INTEGER := 0;
  v_cash_type TEXT;
  v_cash_amount NUMERIC;
BEGIN
  -- Start transaction block
  -- NOTE: PL/pgSQL functions run in a transaction by default
  
  -- Loop through each transaction in the batch
  FOR v_transaction IN SELECT * FROM jsonb_array_elements(p_transactions)
  LOOP
    v_line_number := v_line_number + 1;
    
    BEGIN
      -- Validate required fields
      IF v_transaction->>'date' IS NULL OR
         v_transaction->>'ticker' IS NULL OR
         v_transaction->>'operation' IS NULL OR
         v_transaction->>'quantity' IS NULL OR
         v_transaction->>'price' IS NULL THEN
        
        v_errors := v_errors || jsonb_build_object(
          'line', v_line_number,
          'ticker', COALESCE(v_transaction->>'ticker', 'UNKNOWN'),
          'error', 'Missing required fields (date, ticker, operation, quantity, price)'
        );
        v_failed_count := v_failed_count + 1;
        CONTINUE;
      END IF;

      -- Validate operation type
      IF v_transaction->>'operation' NOT IN ('COMPRA', 'VENTA') THEN
        v_errors := v_errors || jsonb_build_object(
          'line', v_line_number,
          'ticker', v_transaction->>'ticker',
          'error', 'Invalid operation type. Must be COMPRA or VENTA'
        );
        v_failed_count := v_failed_count + 1;
        CONTINUE;
      END IF;

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
        (v_transaction->>'date')::DATE,
        UPPER(TRIM(v_transaction->>'ticker')),
        v_transaction->>'operation',
        CASE 
          WHEN v_transaction->>'operation' = 'VENTA' THEN -ABS((v_transaction->>'quantity')::NUMERIC)
          ELSE ABS((v_transaction->>'quantity')::NUMERIC)
        END,
        (v_transaction->>'price')::NUMERIC,
        COALESCE((v_transaction->>'commission')::NUMERIC, 0),
        v_transaction->>'notes',
        0, -- avg_cost_after will be recalculated
        COALESCE(v_transaction->>'assetType', 'ACCION'),
        COALESCE(v_transaction->>'moneda', 'USD')
      )
      RETURNING id INTO v_inserted_tx_id;

      -- Calculate cash movement type and amount
      v_cash_type := CASE 
        WHEN v_transaction->>'operation' = 'COMPRA' THEN 'RETIRO'
        WHEN v_transaction->>'operation' = 'VENTA' THEN 'DEPOSITO'
      END;

      v_cash_amount := CASE 
        WHEN v_transaction->>'operation' = 'COMPRA' THEN
          (ABS((v_transaction->>'quantity')::NUMERIC) * (v_transaction->>'price')::NUMERIC) + 
          COALESCE((v_transaction->>'commission')::NUMERIC, 0)
        WHEN v_transaction->>'operation' = 'VENTA' THEN
          (ABS((v_transaction->>'quantity')::NUMERIC) * (v_transaction->>'price')::NUMERIC) - 
          COALESCE((v_transaction->>'commission')::NUMERIC, 0)
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
        (v_transaction->>'date')::DATE,
        v_cash_type,
        v_cash_amount,
        v_transaction->>'operation' || ' ' || 
        UPPER(TRIM(v_transaction->>'ticker')) || ' - ' || 
        ABS((v_transaction->>'quantity')::NUMERIC) || ' @ ' || 
        (v_transaction->>'price')::NUMERIC,
        UPPER(TRIM(v_transaction->>'ticker')),
        v_inserted_tx_id,
        NOW()
      );

      v_imported_count := v_imported_count + 1;

    EXCEPTION
      WHEN OTHERS THEN
        -- Capture any database errors (unique constraints, foreign keys, etc.)
        v_errors := v_errors || jsonb_build_object(
          'line', v_line_number,
          'ticker', COALESCE(v_transaction->>'ticker', 'UNKNOWN'),
          'error', SQLERRM
        );
        v_failed_count := v_failed_count + 1;
        -- CONTINUE to next transaction (don't abort entire batch yet)
        CONTINUE;
    END;
  END LOOP;

  -- If ANY transaction failed, rollback everything
  IF v_failed_count > 0 THEN
    RAISE EXCEPTION 'Batch import failed. % transaction(s) had errors. Rolling back entire batch.', v_failed_count
      USING DETAIL = v_errors::TEXT;
  END IF;

  -- Success: return results
  RETURN QUERY SELECT 
    TRUE AS success,
    v_imported_count AS imported,
    v_failed_count AS failed,
    v_errors AS error_details;

EXCEPTION
  WHEN OTHERS THEN
    -- Rollback happened, return error details
    RETURN QUERY SELECT 
      FALSE AS success,
      0 AS imported,
      v_failed_count AS failed,
      v_errors AS error_details;
END;
$$;

-- Add helpful comment
COMMENT ON FUNCTION import_transactions_atomic(UUID, JSONB) IS 
'Atomically imports a batch of transactions with their cash movements. Rolls back entire batch if any transaction fails.';