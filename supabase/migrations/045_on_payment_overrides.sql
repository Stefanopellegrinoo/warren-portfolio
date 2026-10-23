-- Migration 045: the user's corrections to automatic ON payments.
--
-- Coupons and amortizations are no longer stored rows: the ledger core computes
-- them from each bond's schedule and the nominal held at the record date
-- (odd/tasks/nucleo-ledger.md S4, S8). A row here is the user's word over the
-- schedule for one payment of one bond:
--   amount > 0     the broker paid this amount (replaces the computed one), or a
--                  payment no source lists (the app asked the user for it);
--   amount null    the payment was not received.
-- Amounts are in the bond's payment currency (USD), like cash_movements.

create table if not exists public.on_payment_overrides (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  ticker      text        not null,
  pay_date    date        not null,
  kind        text        not null check (kind in ('coupon', 'amortization')),
  amount      numeric(18,4) check (amount is null or amount > 0),
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, ticker, pay_date, kind)
);

create index if not exists idx_on_payment_overrides_user on public.on_payment_overrides(user_id);

alter table public.on_payment_overrides enable row level security;

create policy "own_on_payment_overrides"
  on public.on_payment_overrides
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
