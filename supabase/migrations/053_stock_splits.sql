-- Migration 053: stock splits (odd/tasks/split-aware-ledger.md T2, S2).
--
-- WHY
-- A trade is stored as traded: the quantity and price of the broker ticket that day.
-- After a split the holder has numerator/denominator times the shares, so every
-- computation brings earlier trades to the later basis. The ledger core does it from
-- this table (src/lib/stock-splits.ts); the write RPC needs the same factor to re-check
-- a sale, or a sale of shares bought before a split fails ("Insufficient position").
--
-- WHAT
-- 1. stock_splits: one row per split, keyed by the ledger ticker (upper, trimmed). A
--    market table like fx_rates (049): RLS on, written only by the worker's service
--    role (src/lib/splits-ingest.ts, from Yahoo), no SELECT for anon or authenticated.
-- 2. split_factor(ticker, after): the product of numerator/denominator of the ticker's
--    splits dated after `after`, 1 when there are none. A split applies from its date,
--    so a trade on that date is already on the new basis. SECURITY DEFINER so the RPC,
--    which runs as the signed-in user, can read the table through it; it returns a
--    number only.
-- 3. process_transaction_atomic: 046 verbatim except the sale re-check, which sums the
--    rows in today's basis and compares in the sale's basis. With no splits stored every
--    factor is 1 and the check is 046's.
--
-- SAFETY: a new empty table, a new function and one function body. No data change.
-- Apply it before the deploy: the deployed app reads stock_splits.
-- Rollback: re-run the process_transaction_atomic block of 046, then
-- DROP FUNCTION public.split_factor(text, date); DROP TABLE public.stock_splits;

BEGIN;

CREATE TABLE IF NOT EXISTS public.stock_splits (
  ticker TEXT NOT NULL,
  date DATE NOT NULL,
  numerator NUMERIC NOT NULL CHECK (numerator > 0),
  denominator NUMERIC NOT NULL CHECK (denominator > 0),
  yahoo_symbol TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'yahoo',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, date)
);
ALTER TABLE public.stock_splits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stock_splits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.stock_splits TO service_role;

-- Rounded: EXP(SUM(LN())) is a product up to the last digits (20 comes back as 19.999…).
CREATE OR REPLACE FUNCTION public.split_factor(p_ticker TEXT, p_after DATE)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(ROUND(EXP(SUM(LN(numerator / denominator))), 12), 1)
  FROM public.stock_splits
  WHERE ticker = UPPER(TRIM(p_ticker)) AND date > p_after
$$;
REVOKE EXECUTE ON FUNCTION public.split_factor(TEXT, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.split_factor(TEXT, DATE) TO authenticated, service_role;

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
  -- 053: rows are stored as traded, so each row is brought to today's share basis with
  -- split_factor and the total is compared in the sale's own basis (the core's tolerance).
  IF v_operation = 'VENTA' THEN
    PERFORM pg_advisory_xact_lock(hashtext(v_user_id::text || ':' || v_ticker));
    IF COALESCE((
      SELECT SUM(quantity * public.split_factor(ticker, date)) FROM transactions
      WHERE user_id = v_user_id AND UPPER(TRIM(ticker)) = v_ticker AND operation IN ('COMPRA', 'VENTA')
    ), 0) / public.split_factor(v_ticker, p_date) - ABS(p_quantity) < -0.0001 THEN
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

COMMIT;
