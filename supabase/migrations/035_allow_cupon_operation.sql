-- Migration 035: allow CUPON as a transaction operation
--
-- WHY
-- `transactions.operation` has carried the same CHECK since 001_schema.sql:14 —
-- only COMPRA, VENTA and DIVIDENDO — and no migration ever widened it. Meanwhile
-- BOTH atomic RPCs were written to handle a coupon: process_transaction_atomic
-- (030_fix_rpc_ons_rls.sql:80) inserts a CUPON transaction row, and
-- import_transactions_atomic (018_dividendo_cupon_in_batch.sql:54) accepts CUPON
-- as a valid operation. The ON transaction form offers it too. Every layer was
-- built for coupons except the constraint, so recording one failed at the
-- database — verified 2026-07-30 against the live app, which returned
-- "Invalid Quantity / CHECK violation" depending on the entry path.
--
-- This is the one-line blocker. With it lifted, a coupon entered through the ON
-- form (which supplies ticker, quantity = the coupon amount, and price = 1)
-- flows through the RPC exactly like every other operation: it writes the
-- transaction row AND the linked cash_movements row of type CUPON, which is
-- what the per-universe risk metrics read.
--
-- WHY NOT the cash form instead: processCashMovement passes no quantity, and the
-- RPC exempts only DEPOSITO and RETIRO from the quantity/price/ticker guard
-- (030:62-70). Making the cash path work would mean rewriting that validation
-- block inside the core write-path function. A coupon is paid BY a specific
-- bond, so entering it against that bond's ticker is the better model anyway.
--
-- SAFETY
-- Widening a CHECK cannot invalidate an existing row: every value the old
-- constraint admitted, the new one admits. Measured on the live DB 2026-07-30:
-- zero CUPON rows exist, so nothing is being retro-legitimised.
--
-- DEPLOY ORDER: apply this BEFORE deploying the image. A deploy-first ordering
-- leaves the UI offering an operation the database still rejects — the exact
-- failure this migration removes.

-- The original constraint is declared INLINE in 001_schema.sql:14, so Postgres
-- auto-named it. `drop constraint if exists transactions_operation_check` would
-- be a silent no-op under any other name, and the ADD below would then create a
-- SECOND constraint while the original kept rejecting CUPON — a migration that
-- reports success and changes nothing. Drop by lookup instead of by guess.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'transactions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%operation%'
  loop
    execute format('alter table transactions drop constraint %I', c.conname);
  end loop;
end $$;

alter table transactions
  add constraint transactions_operation_check
  check (operation in ('COMPRA', 'VENTA', 'DIVIDENDO', 'CUPON'));

-- Fail loudly if the result is not what we intended, rather than leaving a
-- half-applied constraint behind.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'transactions'::regclass
      and conname = 'transactions_operation_check'
      and pg_get_constraintdef(oid) ilike '%CUPON%'
  ) then
    raise exception 'Migration 035 did not take: transactions_operation_check does not admit CUPON';
  end if;
end $$;

comment on column transactions.operation is
  'COMPRA / VENTA = trades. DIVIDENDO = stock income. CUPON = ON income (migration 035). Income operations produce a cash_movements row of the same type, which is what src/lib/cash-flows.ts reads for per-universe boundary flows.';
