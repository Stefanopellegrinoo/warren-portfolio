-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 014: Atomic transaction processing with RPC (v3.1 - Testable)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION process_transaction_atomic(
  p_date DATE,
  p_ticker TEXT DEFAULT NULL,
  p_operation TEXT DEFAULT NULL,
  p_quantity NUMERIC DEFAULT NULL,
  p_price NUMERIC DEFAULT NULL,
  p_commission NUMERIC DEFAULT 0,
  p_notes TEXT DEFAULT NULL,
  p_asset_type TEXT DEFAULT 'ACCION',
  p_moneda TEXT DEFAULT 'USD',
  p_user_id UUID DEFAULT NULL  -- Added for testing/backend calls
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_ticker TEXT;
  v_operation TEXT;
  v_asset_type TEXT;
  v_inserted_tx_id UUID;
  v_cash_delta NUMERIC;
  v_commission NUMERIC;
  v_current_qty NUMERIC := 0;
  v_current_avg_cost NUMERIC := 0;
  v_current_total_invested NUMERIC := 0;
  v_new_qty NUMERIC;
  v_new_avg_cost NUMERIC;
  v_new_total_invested NUMERIC;
  v_current_version INT;
BEGIN
  -- 1. SECURITY: Use auth.uid() by default, allow override if provided
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN 
    RAISE EXCEPTION 'Unauthorized: Must be authenticated'; 
  END IF;

  -- 2. Sanitize inputs
  v_ticker := UPPER(TRIM(p_ticker));
  v_operation := UPPER(TRIM(p_operation));
  v_asset_type := UPPER(TRIM(p_asset_type));
  v_commission := COALESCE(p_commission, 0);

  -- 3. Validations
  IF v_operation NOT IN ('DEPOSITO', 'RETIRO') THEN
    IF p_quantity IS NULL OR p_quantity <= 0 THEN 
      RAISE EXCEPTION 'Invalid Quantity: Must be greater than 0'; 
    END IF;
    IF p_price IS NULL OR p_price <= 0 THEN 
      RAISE EXCEPTION 'Invalid Price: Must be greater than 0'; 
    END IF;
    IF v_ticker IS NULL OR v_ticker = '' THEN 
      RAISE EXCEPTION 'Ticker Required'; 
    END IF;
  END IF;

  -- 4. Auto-discover ONs
  IF v_asset_type = 'ON' THEN
    INSERT INTO ons (ticker, currency, created_at)
    VALUES (v_ticker, 'USD', NOW())
    ON CONFLICT (ticker) DO NOTHING;
  END IF;

  -- 5. Insert Transaction
  IF v_operation IN ('COMPRA', 'VENTA', 'DIVIDENDO', 'CUPON') THEN
    INSERT INTO transactions (
      user_id, date, ticker, operation, quantity, price, commission, 
      notes, avg_cost_after, asset_type, moneda
    ) VALUES (
      v_user_id, p_date, v_ticker, v_operation,
      CASE WHEN v_operation = 'VENTA' THEN -ABS(p_quantity) ELSE ABS(p_quantity) END,
      p_price, v_commission, p_notes, 0, v_asset_type, p_moneda
    ) RETURNING id INTO v_inserted_tx_id;
  END IF;

  -- 6. Update position with REAL OPTIMISTIC LOCKING
  IF v_operation IN ('COMPRA', 'VENTA') THEN
    IF v_asset_type = 'ON' THEN
      SELECT quantity, avg_cost, total_invested, version 
      INTO v_current_qty, v_current_avg_cost, v_current_total_invested, v_current_version
      FROM on_positions 
      WHERE user_id = v_user_id AND ticker = v_ticker
      FOR UPDATE;
    ELSE
      SELECT quantity, avg_cost, total_invested, version 
      INTO v_current_qty, v_current_avg_cost, v_current_total_invested, v_current_version
      FROM positions 
      WHERE user_id = v_user_id AND ticker = v_ticker
      FOR UPDATE;
    END IF;

    v_current_qty := COALESCE(v_current_qty, 0);
    v_current_avg_cost := COALESCE(v_current_avg_cost, 0);
    v_current_total_invested := COALESCE(v_current_total_invested, 0);

    IF v_operation = 'COMPRA' THEN
      v_new_qty := v_current_qty + p_quantity;
      v_new_total_invested := v_current_total_invested + (p_quantity * p_price) + v_commission;
      v_new_avg_cost := v_new_total_invested / NULLIF(v_new_qty, 0);
    ELSE -- VENTA
      v_new_qty := v_current_qty - p_quantity;
      IF v_new_qty < -0.0001 THEN 
        RAISE EXCEPTION 'Insufficient position for % (Has %, trying to sell %)', v_ticker, v_current_qty, p_quantity; 
      END IF;
      v_new_avg_cost := v_current_avg_cost;
      v_new_total_invested := v_current_total_invested - (p_quantity * v_current_avg_cost);
    END IF;

    UPDATE transactions SET avg_cost_after = v_new_avg_cost WHERE id = v_inserted_tx_id;

    IF v_asset_type = 'ON' THEN
      INSERT INTO on_positions (user_id, ticker, quantity, avg_cost, total_invested, first_bought, last_updated, version)
      VALUES (v_user_id, v_ticker, v_new_qty, v_new_avg_cost, v_new_total_invested, p_date, NOW(), 1)
      ON CONFLICT (user_id, ticker) DO UPDATE SET
        quantity = EXCLUDED.quantity, 
        avg_cost = EXCLUDED.avg_cost, 
        total_invested = EXCLUDED.total_invested,
        last_updated = NOW(), 
        version = on_positions.version + 1
      WHERE on_positions.version = v_current_version OR v_current_version IS NULL;
      
      IF NOT FOUND AND v_current_version IS NOT NULL THEN
        RAISE EXCEPTION 'Concurrent modification on ON position %', v_ticker;
      END IF;
    ELSE
      INSERT INTO positions (user_id, ticker, quantity, avg_cost, total_invested, first_bought, last_updated, version)
      VALUES (v_user_id, v_ticker, v_new_qty, v_new_avg_cost, v_new_total_invested, p_date, NOW(), 1)
      ON CONFLICT (user_id, ticker) DO UPDATE SET
        quantity = EXCLUDED.quantity, 
        avg_cost = EXCLUDED.avg_cost, 
        total_invested = EXCLUDED.total_invested,
        last_updated = NOW(), 
        version = positions.version + 1
      WHERE positions.version = v_current_version OR v_current_version IS NULL;

      IF NOT FOUND AND v_current_version IS NOT NULL THEN
        RAISE EXCEPTION 'Concurrent modification on position %', v_ticker;
      END IF;
    END IF;
  END IF;

  -- 7. Cash Balance Update with Correct Sign
  IF v_operation IN ('COMPRA', 'VENTA', 'DIVIDENDO', 'CUPON', 'DEPOSITO', 'RETIRO') THEN
    v_cash_delta := CASE
      WHEN v_operation = 'COMPRA' THEN -((p_quantity * p_price) + v_commission)
      WHEN v_operation = 'VENTA' THEN (p_quantity * p_price) - v_commission
      WHEN v_operation IN ('DIVIDENDO', 'CUPON') THEN (p_quantity * p_price)
      WHEN v_operation = 'DEPOSITO' THEN p_price
      WHEN v_operation = 'RETIRO' THEN -p_price
    END;

    INSERT INTO cash_movements (user_id, date, type, amount, description, ticker, transaction_id)
    VALUES (
      v_user_id, 
      p_date, 
      v_operation,
      ABS(v_cash_delta),
      COALESCE(p_notes, v_operation || ' ' || COALESCE(v_ticker, '')), 
      v_ticker, 
      v_inserted_tx_id
    );

    INSERT INTO cash_balance (user_id, balance, updated_at, version) 
    VALUES (v_user_id, 0, NOW(), 1) 
    ON CONFLICT (user_id) DO NOTHING;
    
    UPDATE cash_balance 
    SET balance = balance + v_cash_delta,
        updated_at = NOW(), 
        version = version + 1 
    WHERE user_id = v_user_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true, 
    'transaction_id', v_inserted_tx_id,
    'cash_delta', v_cash_delta
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Transaction failed: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
END;
$$;
