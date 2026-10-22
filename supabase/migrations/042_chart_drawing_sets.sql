-- Migration 042: one drawing document per user and ticker.
--
-- The chart's drawing layer (lightweight-charts-drawing) saves and restores
-- its whole list as JSON, with 80+ tool kinds and their styles. Storing that
-- list as one jsonb document replaces the per-row chart_drawings model, whose
-- CHECK constraint only knew 8 types.
--
-- chart_drawings is left untouched: on the first load of a ticker with no
-- document, the client converts its legacy rows and saves them here.

create table if not exists public.chart_drawing_sets (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  ticker      text        not null,
  drawings    jsonb       not null default '[]'::jsonb check (jsonb_typeof(drawings) = 'array'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, ticker)
);

alter table public.chart_drawing_sets enable row level security;

-- Single policy covers SELECT/INSERT/UPDATE/DELETE; WITH CHECK is mandatory
-- or the upsert will silently fail for the row's owner.
create policy "chart_drawing_sets_owner"
  on public.chart_drawing_sets
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger chart_drawing_sets_set_updated_at
  before update on public.chart_drawing_sets
  for each row execute function public.set_updated_at();
