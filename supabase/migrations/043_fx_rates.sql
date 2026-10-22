-- Migration 043: daily reference dollar rates (MEP and CCL).
--
-- Showing a trade in pesos, MEP and cable needs the rates of its own date.
-- The worker upserts the full history from argentinadatos.com (MEP since
-- 2018-10-29, CCL since 2013-01-02) every weekday night and on start-up.
-- Reference data, not user data: every signed-in user may read it; only the
-- service role (the worker) writes it.

create table if not exists public.fx_rates (
  date        date        not null,
  kind        text        not null check (kind in ('mep', 'ccl')),
  buy         numeric     not null check (buy > 0),
  sell        numeric     not null check (sell > 0),
  source      text        not null default 'argentinadatos',
  updated_at  timestamptz not null default now(),
  primary key (date, kind)
);

alter table public.fx_rates enable row level security;

create policy "fx_rates_read"
  on public.fx_rates
  for select
  to authenticated
  using (true);
