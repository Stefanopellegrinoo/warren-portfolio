-- 027_chart_drawings.sql
-- Persists user-drawn chart annotations (trendlines, fibonacci retracements)
-- per ticker. JSONB on points/style keeps schema stable as new drawing types
-- are added without further migrations.

-- ensure trigger function exists (safe to create or replace)
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create table if not exists public.chart_drawings (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  ticker      text        not null,
  type        text        not null check (type in ('trendline', 'fibonacci')),
  points      jsonb       not null,
  style       jsonb       not null default '{}'::jsonb,
  label       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists chart_drawings_user_ticker_idx
  on public.chart_drawings (user_id, ticker);

alter table public.chart_drawings enable row level security;

-- Single policy covers SELECT/INSERT/UPDATE/DELETE; WITH CHECK is mandatory
-- or PATCH will silently fail for the row's owner.
create policy "chart_drawings_owner"
  on public.chart_drawings
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger chart_drawings_set_updated_at
  before update on public.chart_drawings
  for each row execute function public.set_updated_at();
