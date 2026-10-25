-- Migration 051: chart preferences kept in the account (odd/tasks/chart-customization.md S4).
--
-- One row per user: the drawing tools they starred, the style last chosen per tool, and the indicator
-- settings they saved. The same on every device. Not here, on purpose: which indicators are on or
-- hidden, and where the favorites bar sits (both per device).
--
-- Each column is a map by key (tool kind or indicator key). The app writes through
-- patch_chart_preferences, which merges per key in one statement (a null removes the key), so a
-- device that changes one tool never wipes another tool changed on another device; the same key
-- changed on two devices keeps the last write. /api/chart-preferences validates every key and value
-- (src/lib/chart/preferences-schema.ts); the checks below bound a row written around it with the
-- user's own key: objects only, at most 128 KB per column.
--
-- Nothing reads this table until the code that uses it deploys: until then the app keeps each
-- device's values. Safe to apply before that deploy. Rollback:
--   drop function public.patch_chart_preferences(jsonb, jsonb, jsonb); drop table public.chart_preferences;

begin;

create table if not exists public.chart_preferences (
  user_id             uuid        primary key references auth.users(id) on delete cascade,
  favorites           jsonb       not null default '{}'::jsonb,
  tool_styles         jsonb       not null default '{}'::jsonb,
  indicator_settings  jsonb       not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint chart_preferences_objects check (
    jsonb_typeof(favorites) = 'object' and jsonb_typeof(tool_styles) = 'object' and jsonb_typeof(indicator_settings) = 'object'
  ),
  constraint chart_preferences_size check (
    octet_length(favorites::text) <= 131072 and octet_length(tool_styles::text) <= 131072 and octet_length(indicator_settings::text) <= 131072
  )
);

alter table public.chart_preferences enable row level security;

-- Single policy covers SELECT/INSERT/UPDATE/DELETE; WITH CHECK is mandatory
-- or the upsert will silently fail for the row's owner.
create policy "chart_preferences_owner"
  on public.chart_preferences
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger chart_preferences_set_updated_at
  before update on public.chart_preferences
  for each row execute function public.set_updated_at();

-- SECURITY INVOKER: it runs as the signed-in user, so the policy above decides, and it only ever
-- writes the row of auth.uid().
create or replace function public.patch_chart_preferences(
  p_favorites          jsonb default '{}'::jsonb,
  p_tool_styles        jsonb default '{}'::jsonb,
  p_indicator_settings jsonb default '{}'::jsonb
) returns void
language sql
security invoker
set search_path = public, pg_temp
as $$
  insert into public.chart_preferences as cp (user_id, favorites, tool_styles, indicator_settings)
  values (
    auth.uid(),
    jsonb_strip_nulls(coalesce(p_favorites, '{}'::jsonb)),
    jsonb_strip_nulls(coalesce(p_tool_styles, '{}'::jsonb)),
    jsonb_strip_nulls(coalesce(p_indicator_settings, '{}'::jsonb))
  )
  on conflict (user_id) do update set
    favorites          = jsonb_strip_nulls(cp.favorites          || coalesce(p_favorites, '{}'::jsonb)),
    tool_styles        = jsonb_strip_nulls(cp.tool_styles        || coalesce(p_tool_styles, '{}'::jsonb)),
    indicator_settings = jsonb_strip_nulls(cp.indicator_settings || coalesce(p_indicator_settings, '{}'::jsonb));
$$;

-- As in 048: no EXECUTE from PUBLIC or anon, only signed-in users.
revoke execute on function public.patch_chart_preferences(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.patch_chart_preferences(jsonb, jsonb, jsonb) to authenticated, service_role;

commit;
