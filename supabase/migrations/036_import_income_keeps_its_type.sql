-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 036: imported income keeps its own cash_movements type
--
-- Both bulk-import RPCs mapped DIVIDENDO and CUPON to type = 'DEPOSITO' with
-- transaction_id SET. Such a row is invisible to BOTH income queries:
--   fetchIncomeMovements  filters type IN ('CUPON','DIVIDENDO')  -> misses it
--   fetchExternalFlows    filters transaction_id IS NULL       -> misses it
-- so an imported dividend history read every ex-date drop as an uncompensated
-- loss in the `stocks` universe, while the same row entered through the app
-- (process_transaction_atomic) was typed DIVIDENDO and declared correctly.
-- The identical spreadsheet row produced different metrics per entry path.
--
-- The sign does NOT change: cash-signs.ts CASH_CREDIT_TYPES already holds
-- DEPOSITO, CUPON and DIVIDENDO, so all three credit the balance. The
-- cash_movements type CHECK already admits both (migration 015).
--
-- Redefines the two functions verbatim from migrations 018 and 031 with only
-- the v_cash_type CASE changed.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- import_transactions_atomic — verbatim from migration 018, v_cash_type changed
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
    
    -- Validate DATE
    IF v_transaction->>'date' IS NULL OR v_transaction->>'date' = '' THEN
      RAISE EXCEPTION 'Line %: Missing DATE field', v_line_number;
    END IF;
    
    -- Validate TICKER
    v_ticker := UPPER(TRIM(v_transaction->>'ticker'));
    IF v_ticker = '' THEN
      RAISE EXCEPTION 'Line %: Missing TICKER field', v_line_number;
    END IF;
    
    -- Validate OPERATION
    v_operation := UPPER(TRIM(v_transaction->>'operation'));
    IF v_operation = '' THEN
      RAISE EXCEPTION 'Line %: Missing OPERATION field', v_line_number;
    END IF;
    
    -- Validation for all operation types
    IF v_operation NOT IN ('COMPRA', 'VENTA', 'DIVIDENDO', 'CUPON') THEN
      RAISE EXCEPTION 'Line %: Invalid operation type "%". Must be COMPRA, VENTA, DIVIDENDO or CUPON', 
        v_line_number, v_operation;
    END IF;
    
    -- Validate QUANTITY and PRICE
    IF v_transaction->>'quantity' IS NULL OR v_transaction->>'quantity' = '' THEN
      RAISE EXCEPTION 'Line %: Missing QUANTITY field', v_line_number;
    END IF;
    IF v_transaction->>'price' IS NULL OR v_transaction->>'price' = '' THEN
      RAISE EXCEPTION 'Line %: Missing PRICE field', v_line_number;
    END IF;
    
    -- Direct casts
    v_date := (v_transaction->>'date')::DATE;
    v_quantity := (v_transaction->>'quantity')::NUMERIC;
    v_price := (v_transaction->>'price')::NUMERIC;
    v_commission := COALESCE((v_transaction->>'commission')::NUMERIC, 0);
    
    -- Validate positivity
    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'Line %: QUANTITY must be greater than 0', v_line_number;
    END IF;
    IF v_price <= 0 THEN
      RAISE EXCEPTION 'Line %: PRICE must be greater than 0', v_line_number;
    END IF;
    
    -- 1. Insert Transaction
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
    
    -- 2. Calculate cash movement (Enhanced for DIVIDENDO/CUPON)
    v_cash_type := CASE 
      WHEN v_operation = 'COMPRA' THEN 'RETIRO'
      WHEN v_operation = 'VENTA' THEN 'DEPOSITO'
      -- Income keeps its OWN type. 'DEPOSITO' here made an imported dividend
      -- invisible to fetchIncomeMovements (filters on type) AND to
      -- fetchExternalFlows (filters transaction_id IS NULL), so every ex-date
      -- drop read as an uncompensated loss. See migration 036's header.
      WHEN v_operation = 'DIVIDENDO' THEN 'DIVIDENDO'
      WHEN v_operation = 'CUPON' THEN 'CUPON'
    END;
    
    v_cash_amount := CASE 
      WHEN v_operation = 'COMPRA' THEN (v_quantity * v_price) + v_commission
      WHEN v_operation = 'VENTA' THEN (v_quantity * v_price) - v_commission
      WHEN v_operation IN ('DIVIDENDO', 'CUPON') THEN (v_quantity * v_price)
    END;
    
    -- Insert cash movement
    INSERT INTO cash_movements (
      user_id, date, type, amount, description, ticker, transaction_id, created_at
    ) VALUES (
      p_user_id, v_date, v_cash_type, v_cash_amount,
      v_operation || ' ' || v_ticker || ' - ' || v_quantity || ' @ ' || v_price,
      v_ticker, v_inserted_tx_id, NOW()
    );
    
    v_imported_count := v_imported_count + 1;
  END LOOP;
  
  -- SUCCESS
  RETURN QUERY SELECT TRUE AS success, v_imported_count AS imported, 0 AS failed, '[]'::JSONB AS error_details;

EXCEPTION
  WHEN OTHERS THEN
    RETURN QUERY SELECT FALSE AS success, 0 AS imported, 1 AS failed, 
      jsonb_build_array(jsonb_build_object('line', v_line_number, 'ticker', COALESCE(v_ticker, 'UNKNOWN'), 'error', SQLERRM)) AS error_details;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- replace_portfolio_atomic — verbatim from migration 031, v_cash_type changed
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Problem: replace_portfolio_atomic (migration 019) ran
--   DELETE FROM cash_movements WHERE user_id = p_user_id;
-- and then regenerated movements only from the imported transactions.
-- Manual deposits, withdrawals and balance adjustments have NO source
-- transaction (transaction_id IS NULL), so they were unrecoverable after any
-- full reimport. On the maintainer's portfolio that is 8 rows carrying
-- 392,980.10 in deposits and 29,500.00 in withdrawals.
--
-- Fix: only delete movements linked to a transaction. Those are redundant —
-- they are regenerated from the imported rows (and the subsequent
-- DELETE FROM transactions cascades them anyway via
-- fk_cash_movements_transaction ON DELETE CASCADE). Movements with
-- transaction_id IS NULL are the user's own external-flow history and MUST
-- survive the replace. The app-side rebuildCashBalance() that runs after this
-- RPC replays preserved + regenerated movements into the final balance.
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
  --    ONLY transaction-linked cash movements are deleted. Manual deposits,
  --    withdrawals and balance adjustments (transaction_id IS NULL) survive.
  DELETE FROM closed_trades WHERE user_id = p_user_id;
  DELETE FROM on_closed_trades WHERE user_id = p_user_id;
  DELETE FROM positions WHERE user_id = p_user_id;
  DELETE FROM on_positions WHERE user_id = p_user_id;
  DELETE FROM cash_movements WHERE user_id = p_user_id AND transaction_id IS NOT NULL;
  DELETE FROM transactions WHERE user_id = p_user_id;

  -- Reset cash balance — the caller rebuilds it from the ledger afterwards
  -- (preserved manual movements + regenerated transaction movements).
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
      WHEN v_operation = 'VENTA' THEN 'DEPOSITO'
      -- Income keeps its OWN type. 'DEPOSITO' here made an imported dividend
      -- invisible to fetchIncomeMovements (filters on type) AND to
      -- fetchExternalFlows (filters transaction_id IS NULL), so every ex-date
      -- drop read as an uncompensated loss. See migration 036's header.
      WHEN v_operation = 'DIVIDENDO' THEN 'DIVIDENDO'
      WHEN v_operation = 'CUPON' THEN 'CUPON'
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

COMMENT ON FUNCTION replace_portfolio_atomic(UUID, JSONB) IS
'Atomic replace of the portfolio. Deletes positions, closed trades, transactions and their linked cash movements, then re-imports. Manual cash movements (transaction_id IS NULL) are preserved.';
