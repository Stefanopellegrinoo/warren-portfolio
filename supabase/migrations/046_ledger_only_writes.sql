-- Migration 046: the write RPCs validate and insert ledger rows only.
--
-- WHY (odd/tasks/nucleo-ledger.md T5.1, S5)
-- The ledger (`transactions` + `cash_movements` + ON payment overrides) is the
-- only source of truth. Since T4.2b every screen reads holdings, cost, realized
-- P&L and cash from the ledger core (src/lib/ledger-core.ts), so the stored
-- derived state these functions maintained (positions, on_positions,
-- closed_trades, on_closed_trades, cash_balance) is read by nothing but the
-- reconciliation gate. Maintaining it here was a second implementation of the
-- running average cost, which disagreed with the core (L8: VIST realized).
--
-- WHAT
-- 1. process_transaction_atomic: same 044 signature (CREATE OR REPLACE on the
--    identical argument list keeps one overload, so every caller and grant is
--    unchanged). It validates the inputs and inserts the transaction and its
--    linked cash movement, or a single cash movement for DEPOSITO, RETIRO and a
--    DIVIDENDO without quantity (the cash form; the old body rejected it for
--    the missing quantity, L3). "Cannot sell more than held" is no longer
--    checked here: the application runs the core's rule on the ledger after the
--    write (src/lib/ledger-write.ts) before calling. CUPON is refused: ON
--    coupons are automatic from the bond schedule (S4) and corrected per payment
--    (S10); there are no CUPON rows to migrate (L12).
-- 2. import_transactions_atomic / replace_portfolio_atomic: 036 verbatim except
--    CUPON is refused and replace deletes only ledger rows (transactions and
--    their linked cash movements; manual movements survive as before). Trade
--    cash movements keep 036's RETIRO/DEPOSITO typing: same sign through
--    src/lib/cash-signs.ts, so the core's cash is unchanged.
-- 3. The stored tables stay in place; T5.2 drops them after a backup.
--
-- SAFETY: function bodies only, no data change. Applying it before the app
-- deploy only stops the stored tables from being updated (nobody reads them);
-- the deployed app before T5.1 still writes ledger rows through the same calls.

create or replace function public.process_transaction_atomic(
  p_date DATE,
  p_ticker TEXT DEFAULT NULL,
  p_operation TEXT DEFAULT NULL,
  p_quantity NUMERIC DEFAULT NULL,
  p_price NUMERIC DEFAULT NULL,
  p_commission NUMERIC DEFAULT 0,
  p_notes TEXT DEFAULT NULL,
  p_asset_type TEXT DEFAULT 'ACCION',
  p_moneda TEXT DEFAULT 'USD',
  p_user_id UUID DEFAULT NULL,
  p_trade_currency TEXT DEFAULT NULL,
  p_trade_quantity NUMERIC DEFAULT NULL,
  p_trade_price NUMERIC DEFAULT NULL,
  p_trade_commission NUMERIC DEFAULT NULL,
  p_cedear_ratio NUMERIC DEFAULT NULL,
  p_fx_mep NUMERIC DEFAULT NULL,
  p_fx_ccl NUMERIC DEFAULT NULL,
  p_fx_date DATE DEFAULT NULL,
  p_fx_source TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id UUID;
  v_ticker TEXT;
  v_operation TEXT;
  v_asset_type TEXT;
  v_commission NUMERIC;
  v_inserted_tx_id UUID;
  v_cash_delta NUMERIC;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Must be authenticated';
  END IF;

  v_ticker := NULLIF(UPPER(TRIM(p_ticker)), '');
  v_operation := UPPER(TRIM(p_operation));
  v_asset_type := UPPER(TRIM(p_asset_type));
  v_commission := COALESCE(p_commission, 0);

  IF v_operation IS NULL OR v_operation NOT IN ('COMPRA', 'VENTA', 'DIVIDENDO', 'DEPOSITO', 'RETIRO') THEN
    RAISE EXCEPTION 'Invalid Operation: %', v_operation;
  END IF;
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'Date Required';
  END IF;
  IF p_price IS NULL OR p_price <= 0 THEN
    RAISE EXCEPTION 'Invalid Price: Must be greater than 0';
  END IF;

  -- Cash only: a deposit, a withdrawal, or income entered as an amount (p_price).
  IF v_operation IN ('DEPOSITO', 'RETIRO') OR (v_operation = 'DIVIDENDO' AND p_quantity IS NULL) THEN
    INSERT INTO cash_movements (user_id, date, type, amount, description, ticker, transaction_id)
    VALUES (v_user_id, p_date, v_operation, ABS(p_price), COALESCE(p_notes, v_operation || ' ' || COALESCE(v_ticker, '')), v_ticker, NULL);

    RETURN jsonb_build_object(
      'success', true,
      'transaction_id', NULL,
      'cash_delta', CASE WHEN v_operation = 'RETIRO' THEN -ABS(p_price) ELSE ABS(p_price) END
    );
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Invalid Quantity: Must be greater than 0';
  END IF;
  IF v_ticker IS NULL THEN
    RAISE EXCEPTION 'Ticker Required';
  END IF;

  -- The app validates every sale against the ledger core (dates included) before calling
  -- this function, but that check and this insert are not one transaction. 044 serialized
  -- sales with FOR UPDATE on the stored position; with no stored state, sales of one ticker
  -- by one user are serialized here, and the total held is re-checked from the ledger itself
  -- (sales are stored negative), so two simultaneous sales cannot both pass.
  IF v_operation = 'VENTA' THEN
    PERFORM pg_advisory_xact_lock(hashtext(v_user_id::text || ':' || v_ticker));
    IF COALESCE((
      SELECT SUM(quantity) FROM transactions
      WHERE user_id = v_user_id AND UPPER(TRIM(ticker)) = v_ticker AND operation IN ('COMPRA', 'VENTA')
    ), 0) - ABS(p_quantity) < -0.0001 THEN
      RAISE EXCEPTION 'Insufficient position: cannot sell % %', ABS(p_quantity), v_ticker;
    END IF;
  END IF;

  INSERT INTO transactions (
    user_id, date, ticker, operation, quantity, price, commission,
    notes, avg_cost_after, asset_type, moneda,
    trade_currency, trade_quantity, trade_price, trade_commission,
    cedear_ratio, fx_mep, fx_ccl, fx_date, fx_source
  ) VALUES (
    v_user_id, p_date, v_ticker, v_operation,
    CASE WHEN v_operation = 'VENTA' THEN -ABS(p_quantity) ELSE ABS(p_quantity) END,
    p_price, v_commission, p_notes, 0, v_asset_type, p_moneda,
    p_trade_currency, ABS(p_trade_quantity), p_trade_price, p_trade_commission,
    p_cedear_ratio, p_fx_mep, p_fx_ccl, p_fx_date, p_fx_source
  ) RETURNING id INTO v_inserted_tx_id;

  v_cash_delta := CASE
    WHEN v_operation = 'COMPRA' THEN -((p_quantity * p_price) + v_commission)
    WHEN v_operation = 'VENTA' THEN (p_quantity * p_price) - v_commission
    ELSE p_quantity * p_price
  END;

  INSERT INTO cash_movements (user_id, date, type, amount, description, ticker, transaction_id)
  VALUES (
    v_user_id, p_date, v_operation, ABS(v_cash_delta),
    COALESCE(p_notes, v_operation || ' ' || v_ticker), v_ticker, v_inserted_tx_id
  );

  RETURN jsonb_build_object('success', true, 'transaction_id', v_inserted_tx_id, 'cash_delta', v_cash_delta);

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Transaction failed: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- import_transactions_atomic — 036 verbatim, CUPON refused
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.import_transactions_atomic(
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
  FOR v_transaction IN SELECT * FROM jsonb_array_elements(p_transactions)
  LOOP
    v_line_number := v_line_number + 1;

    IF v_transaction->>'date' IS NULL OR v_transaction->>'date' = '' THEN
      RAISE EXCEPTION 'Line %: Missing DATE field', v_line_number;
    END IF;

    v_ticker := UPPER(TRIM(v_transaction->>'ticker'));
    IF v_ticker = '' THEN
      RAISE EXCEPTION 'Line %: Missing TICKER field', v_line_number;
    END IF;

    v_operation := UPPER(TRIM(v_transaction->>'operation'));
    IF v_operation = '' THEN
      RAISE EXCEPTION 'Line %: Missing OPERATION field', v_line_number;
    END IF;

    IF v_operation NOT IN ('COMPRA', 'VENTA', 'DIVIDENDO') THEN
      RAISE EXCEPTION 'Line %: Invalid operation type "%". Must be COMPRA, VENTA or DIVIDENDO',
        v_line_number, v_operation;
    END IF;

    IF v_transaction->>'quantity' IS NULL OR v_transaction->>'quantity' = '' THEN
      RAISE EXCEPTION 'Line %: Missing QUANTITY field', v_line_number;
    END IF;
    IF v_transaction->>'price' IS NULL OR v_transaction->>'price' = '' THEN
      RAISE EXCEPTION 'Line %: Missing PRICE field', v_line_number;
    END IF;

    v_date := (v_transaction->>'date')::DATE;
    v_quantity := (v_transaction->>'quantity')::NUMERIC;
    v_price := (v_transaction->>'price')::NUMERIC;
    v_commission := COALESCE((v_transaction->>'commission')::NUMERIC, 0);

    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'Line %: QUANTITY must be greater than 0', v_line_number;
    END IF;
    IF v_price <= 0 THEN
      RAISE EXCEPTION 'Line %: PRICE must be greater than 0', v_line_number;
    END IF;

    INSERT INTO transactions (
      user_id, date, ticker, operation, quantity, price, commission,
      notes, avg_cost_after, asset_type, moneda
    ) VALUES (
      p_user_id, v_date, v_ticker, v_operation,
      CASE WHEN v_operation = 'VENTA' THEN -ABS(v_quantity) ELSE ABS(v_quantity) END,
      v_price, v_commission, v_transaction->>'notes', 0,
      COALESCE(UPPER(v_transaction->>'assetType'), 'ACCION'),
      COALESCE(UPPER(v_transaction->>'moneda'), 'USD')
    )
    RETURNING id INTO v_inserted_tx_id;

    v_cash_type := CASE
      WHEN v_operation = 'COMPRA' THEN 'RETIRO'
      WHEN v_operation = 'VENTA' THEN 'DEPOSITO'
      WHEN v_operation = 'DIVIDENDO' THEN 'DIVIDENDO'
    END;

    v_cash_amount := CASE
      WHEN v_operation = 'COMPRA' THEN (v_quantity * v_price) + v_commission
      WHEN v_operation = 'VENTA' THEN (v_quantity * v_price) - v_commission
      WHEN v_operation = 'DIVIDENDO' THEN (v_quantity * v_price)
    END;

    INSERT INTO cash_movements (
      user_id, date, type, amount, description, ticker, transaction_id, created_at
    ) VALUES (
      p_user_id, v_date, v_cash_type, v_cash_amount,
      v_operation || ' ' || v_ticker || ' - ' || v_quantity || ' @ ' || v_price,
      v_ticker, v_inserted_tx_id, NOW()
    );

    v_imported_count := v_imported_count + 1;
  END LOOP;

  RETURN QUERY SELECT TRUE AS success, v_imported_count AS imported, 0 AS failed, '[]'::JSONB AS error_details;

EXCEPTION
  WHEN OTHERS THEN
    RETURN QUERY SELECT FALSE AS success, 0 AS imported, 1 AS failed,
      jsonb_build_array(jsonb_build_object('line', v_line_number, 'ticker', COALESCE(v_ticker, 'UNKNOWN'), 'error', SQLERRM)) AS error_details;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- replace_portfolio_atomic — 036 verbatim, CUPON refused, ledger rows only
-- ═══════════════════════════════════════════════════════════════════════════
-- Deletes the user's transactions and their linked cash movements (the cascade
-- would take them too), keeps manual movements (transaction_id IS NULL: the
-- user's own deposits, withdrawals and balance adjustments), then re-imports.

CREATE OR REPLACE FUNCTION public.replace_portfolio_atomic(
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
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: User ID is required';
  END IF;

  DELETE FROM cash_movements WHERE user_id = p_user_id AND transaction_id IS NOT NULL;
  DELETE FROM transactions WHERE user_id = p_user_id;

  FOR v_transaction IN SELECT * FROM jsonb_array_elements(p_transactions)
  LOOP
    v_line_number := v_line_number + 1;

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

    IF v_operation NOT IN ('COMPRA', 'VENTA', 'DIVIDENDO') THEN
      RAISE EXCEPTION 'Line %: Invalid operation type "%". Must be COMPRA, VENTA or DIVIDENDO',
        v_line_number, v_operation;
    END IF;

    v_date := (v_transaction->>'date')::DATE;
    v_quantity := (v_transaction->>'quantity')::NUMERIC;
    v_price := (v_transaction->>'price')::NUMERIC;
    v_commission := COALESCE((v_transaction->>'commission')::NUMERIC, 0);

    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'Line %: QUANTITY must be greater than 0', v_line_number;
    END IF;
    IF v_price <= 0 THEN
      RAISE EXCEPTION 'Line %: PRICE must be greater than 0', v_line_number;
    END IF;

    INSERT INTO transactions (
      user_id, date, ticker, operation, quantity, price, commission,
      notes, avg_cost_after, asset_type, moneda
    ) VALUES (
      p_user_id, v_date, v_ticker, v_operation,
      CASE WHEN v_operation = 'VENTA' THEN -ABS(v_quantity) ELSE ABS(v_quantity) END,
      v_price, v_commission, v_transaction->>'notes', 0,
      COALESCE(UPPER(v_transaction->>'assetType'), 'ACCION'),
      COALESCE(UPPER(v_transaction->>'moneda'), 'USD')
    )
    RETURNING id INTO v_inserted_tx_id;

    v_cash_type := CASE
      WHEN v_operation = 'COMPRA' THEN 'RETIRO'
      WHEN v_operation = 'VENTA' THEN 'DEPOSITO'
      WHEN v_operation = 'DIVIDENDO' THEN 'DIVIDENDO'
    END;

    v_cash_amount := CASE
      WHEN v_operation = 'COMPRA' THEN (v_quantity * v_price) + v_commission
      WHEN v_operation = 'VENTA' THEN (v_quantity * v_price) - v_commission
      WHEN v_operation = 'DIVIDENDO' THEN (v_quantity * v_price)
    END;

    INSERT INTO cash_movements (
      user_id, date, type, amount, description, ticker, transaction_id, created_at
    ) VALUES (
      p_user_id, v_date, v_cash_type, v_cash_amount,
      v_operation || ' ' || v_ticker || ' - ' || v_quantity || ' @ ' || v_price,
      v_ticker, v_inserted_tx_id, NOW()
    );

    v_imported_count := v_imported_count + 1;
  END LOOP;

  RETURN QUERY SELECT TRUE AS success, v_imported_count AS imported, 0 AS failed, '[]'::JSONB AS error_details;

EXCEPTION
  WHEN OTHERS THEN
    RETURN QUERY SELECT FALSE AS success, 0 AS imported, 1 AS failed,
      jsonb_build_array(jsonb_build_object('line', v_line_number, 'ticker', COALESCE(v_ticker, 'UNKNOWN'), 'error', SQLERRM)) AS error_details;
END;
$$;

COMMENT ON FUNCTION public.replace_portfolio_atomic(UUID, JSONB) IS
'Atomic replace of the ledger: deletes the user''s transactions and their linked cash movements, then re-imports. Manual cash movements (transaction_id IS NULL) are preserved. Derived state is computed by the ledger core, never stored.';

do $$
begin
  if (select count(*) from pg_proc where proname = 'process_transaction_atomic' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'Migration 046: expected exactly one process_transaction_atomic';
  end if;
  if not has_function_privilege('authenticated', 'public.process_transaction_atomic(date, text, text, numeric, numeric, numeric, text, text, text, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, date, text)', 'execute') then
    raise exception 'Migration 046: authenticated cannot execute process_transaction_atomic';
  end if;
end $$;
