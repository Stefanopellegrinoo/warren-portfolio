-- Migration 044: the faithful trade record.
--
-- WHY
-- A CEDEAR trade is stored in engine units (underlying shares, USD-CCL per
-- share). What the user actually typed — the CEDEAR count, the price per CEDEAR
-- in pesos / dólar MEP / dólar cable, the ratio and the FX of the day — was
-- discarded, so nothing can be shown in pesos, MEP and cable later (stage C of
-- docs/superpowers/specs/2026-10-22-multimoneda-design.md).
--
-- WHAT
-- 1. Additive, nullable columns on `transactions`. No existing row changes; the
--    only NOT NULL column has a default, so no existing row can fail it.
-- 2. process_transaction_atomic gains nine optional parameters (default NULL)
--    that fill those columns. Adding parameters changes the signature, and
--    CREATE OR REPLACE on a new signature would leave the old function as a
--    second overload: every PostgREST call naming only the old parameters would
--    then be ambiguous between the two. So it is DROP + CREATE, in this one
--    transaction. The body is 030_fix_rpc_ons_rls.sql verbatim except the
--    INSERT in step 5. Callers that send only the old parameters (cash, ON,
--    portfolio-engine without a ticket) get exactly the old behaviour.
--    Grants: no migration ever granted or revoked on this function, so it
--    carries Supabase's default privileges for the public schema; CREATE
--    re-applies them. The explicit GRANT below only makes the two callers that
--    matter independent of those defaults, and the check at the end fails the
--    migration if `authenticated` cannot execute it.
-- 3. apply_trade_record_backfill: the single-statement writer used by
--    scripts/backfill-trade-record.ts. It updates ONLY the new columns, for one
--    user, in one transaction, and fails if any planned row is not found.
--    Service role only.
--
-- SAFETY: additive schema + a function swap. Before applying, compare the live
-- body (select pg_get_functiondef('public.process_transaction_atomic'::regproc))
-- with 030 — this migration assumes 030 is what runs today.

alter table public.transactions
  add column if not exists trade_currency   text check (trade_currency in ('ARS', 'MEP', 'CCL')),
  add column if not exists trade_quantity   numeric,
  add column if not exists trade_price      numeric,
  add column if not exists trade_commission numeric,
  add column if not exists cedear_ratio     numeric,
  add column if not exists fx_mep           numeric,
  add column if not exists fx_ccl           numeric,
  add column if not exists fx_date          date,
  add column if not exists fx_source        text check (fx_source in ('reference', 'user', 'reconstructed')),
  add column if not exists needs_review     boolean not null default false,
  add column if not exists review_note      text;

comment on column public.transactions.trade_currency is 'Currency the trade settled in, as on the broker ticket: ARS, MEP (dólar bolsa) or CCL (dólar cable). NULL = not recorded (pre-044 row not yet reconstructed).';
comment on column public.transactions.trade_quantity is 'Instrument units as on the ticket, always positive: CEDEAR count, share count, or the ON ledger convention (VN / 100). The engine quantity is `quantity`.';
comment on column public.transactions.trade_price is 'Price per instrument unit, in trade_currency.';
comment on column public.transactions.trade_commission is 'Commission total, in trade_currency.';
comment on column public.transactions.cedear_ratio is 'CEDEARs per underlying share used to derive quantity and price.';
comment on column public.transactions.fx_mep is 'Dólar MEP (ARS per USD) of the trade, see fx_source.';
comment on column public.transactions.fx_ccl is 'Dólar cable (ARS per USD) of the trade, see fx_source.';
comment on column public.transactions.fx_date is 'Date of the reference FX used (the trade date, or the previous day with a rate).';
comment on column public.transactions.fx_source is 'reference = fx_rates close; user = typed by the user; reconstructed = rebuilt approximately for a pre-044 row.';
comment on column public.transactions.needs_review is 'The trade record is uncertain and should be checked by the user; review_note says why.';

drop function if exists public.process_transaction_atomic(date, text, text, numeric, numeric, numeric, text, text, text, uuid);

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
  v_inserted_tx_id UUID;
  v_cash_delta NUMERIC;
  v_commission NUMERIC;
  v_current_qty NUMERIC := 0;
  v_current_avg_cost NUMERIC := 0;
  v_current_total_invested NUMERIC := 0;
  v_first_bought DATE;
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

  -- 4. Auto-discover ONs → MOVED to application layer (on-engine.ts)

  -- 5. Insert Transaction (044: plus the trade record, NULL when not sent)
  IF v_operation IN ('COMPRA', 'VENTA', 'DIVIDENDO', 'CUPON') THEN
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
  END IF;

  -- 6. Update position with REAL OPTIMISTIC LOCKING
  IF v_operation IN ('COMPRA', 'VENTA') THEN
    IF v_asset_type = 'ON' THEN
      SELECT quantity, avg_cost, total_invested, first_bought, version
      INTO v_current_qty, v_current_avg_cost, v_current_total_invested, v_first_bought, v_current_version
      FROM on_positions
      WHERE user_id = v_user_id AND ticker = v_ticker
      FOR UPDATE;
    ELSE
      SELECT quantity, avg_cost, total_invested, first_bought, version
      INTO v_current_qty, v_current_avg_cost, v_current_total_invested, v_first_bought, v_current_version
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
      IF v_current_qty = 0 THEN v_first_bought := p_date; END IF;
    ELSE -- VENTA
      v_new_qty := v_current_qty - p_quantity;
      IF v_new_qty < -0.0001 THEN
        RAISE EXCEPTION 'Insufficient position for % (Has %, trying to sell %)', v_ticker, v_current_qty, p_quantity;
      END IF;
      v_new_avg_cost := v_current_avg_cost;
      v_new_total_invested := v_current_total_invested - (p_quantity * v_current_avg_cost);

      -- CLOSED TRADES LOGIC
      IF v_asset_type = 'ON' THEN
        INSERT INTO on_closed_trades (
          user_id, ticker, open_date, close_date, avg_cost,
          close_price, quantity, invested, proceeds, transaction_id
        ) VALUES (
          v_user_id, v_ticker, COALESCE(v_first_bought, p_date), p_date, v_current_avg_cost,
          p_price, p_quantity, (v_current_avg_cost * p_quantity), (p_price * p_quantity) - v_commission, v_inserted_tx_id
        );
      ELSE
        INSERT INTO closed_trades (
          user_id, ticker, open_date, close_date, avg_cost,
          close_price, quantity, invested, proceeds, transaction_id
        ) VALUES (
          v_user_id, v_ticker, COALESCE(v_first_bought, p_date), p_date, v_current_avg_cost,
          p_price, p_quantity, (v_current_avg_cost * p_quantity), (p_price * p_quantity) - v_commission, v_inserted_tx_id
        );
      END IF;
    END IF;

    UPDATE transactions SET avg_cost_after = v_new_avg_cost WHERE id = v_inserted_tx_id;

    IF v_asset_type = 'ON' THEN
      INSERT INTO on_positions (user_id, ticker, quantity, avg_cost, total_invested, first_bought, last_updated, version)
      VALUES (v_user_id, v_ticker, v_new_qty, v_new_avg_cost, v_new_total_invested, COALESCE(v_first_bought, p_date), NOW(), 1)
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
      VALUES (v_user_id, v_ticker, v_new_qty, v_new_avg_cost, v_new_total_invested, COALESCE(v_first_bought, p_date), NOW(), 1)
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

    IF v_new_qty <= 0.0001 THEN
      IF v_asset_type = 'ON' THEN
        DELETE FROM on_positions WHERE user_id = v_user_id AND ticker = v_ticker;
      ELSE
        DELETE FROM positions WHERE user_id = v_user_id AND ticker = v_ticker;
      END IF;
    END IF;
  END IF;

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

grant execute on function public.process_transaction_atomic(date, text, text, numeric, numeric, numeric, text, text, text, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, date, text) to authenticated, service_role;

-- Backfill writer: only the 044 columns, one user, all or nothing.
create or replace function public.apply_trade_record_backfill(p_user_id uuid, p_rows jsonb)
returns integer
language plpgsql
security invoker
as $$
declare
  v_count integer;
begin
  update public.transactions t set
    trade_currency   = r.trade_currency,
    trade_quantity   = r.trade_quantity,
    trade_price      = r.trade_price,
    trade_commission = r.trade_commission,
    cedear_ratio     = r.cedear_ratio,
    fx_mep           = r.fx_mep,
    fx_ccl           = r.fx_ccl,
    fx_date          = r.fx_date,
    fx_source        = r.fx_source,
    needs_review     = coalesce(r.needs_review, false),
    review_note      = r.review_note
  from jsonb_to_recordset(p_rows) as r(
    id uuid, trade_currency text, trade_quantity numeric, trade_price numeric, trade_commission numeric,
    cedear_ratio numeric, fx_mep numeric, fx_ccl numeric, fx_date date, fx_source text,
    needs_review boolean, review_note text
  )
  where t.id = r.id and t.user_id = p_user_id;

  get diagnostics v_count = row_count;
  if v_count <> jsonb_array_length(p_rows) then
    raise exception 'apply_trade_record_backfill: % rows planned, % updated; nothing written', jsonb_array_length(p_rows), v_count;
  end if;
  return v_count;
end;
$$;

revoke all on function public.apply_trade_record_backfill(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_trade_record_backfill(uuid, jsonb) to service_role;

do $$
begin
  if not has_function_privilege('authenticated', 'public.process_transaction_atomic(date, text, text, numeric, numeric, numeric, text, text, text, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, date, text)', 'execute') then
    raise exception 'Migration 044: authenticated cannot execute process_transaction_atomic';
  end if;
  if (select count(*) from pg_proc where proname = 'process_transaction_atomic' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'Migration 044: expected exactly one process_transaction_atomic';
  end if;
end $$;
