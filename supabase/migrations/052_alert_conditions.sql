-- Migration 052: alert conditions like TradingView (odd/tasks/chart-customization.md S6, S7).
--
-- An alert watches a source (the price, or an indicator line) crossing a target (a value typed by hand,
-- the price, or another line) up, down or either way:
--   source     'price' or '<indicator>.<line>' (src/lib/chart/alert-condition.ts ALERT_LINES; a test keeps
--              the two lists below equal to it)
--   target     'value' (the alert's value), 'price', or another line; never the source
--   operator   crosses_above / crosses_below as before, and 'crosses' for either way
--   value      the value typed by hand; null against a line
--   timeframe  the chart's interval when an indicator condition was created; its candles are evaluated
--   periods    the indicator periods of its creation ({"ema50": 50}, {"rsi": 14}, …); {} for OBV
--   color      the alert's color (#rrggbb); null keeps the chart's accent, as every alert had before
--   status     'unavailable' ("No se puede revisar"): the worker could not compute the condition (S7)
--
-- Existing rows keep their meaning: the defaults make every one of them the price against its value,
-- up or down as its operator says, with no timeframe, no periods and no color. A client still running
-- older code writes the same columns as before and gets the same defaults. `type` predates this: the
-- app only ever wrote 'price' and nothing evaluates the other types; it stays as it is, and what an
-- alert watches is now source/target. RLS is unchanged ("users own their alerts", 026).
--
-- Applied by hand in the SQL Editor right before the merge that deploys the code that writes these
-- values; until that deploy nothing writes them. The constraint names are the ones 026 got from
-- Postgres; a DROP that does not find its name aborts the whole migration.
-- Rollback (only while no row uses a new value):
--   alter table public.price_alerts drop constraint price_alerts_source_check, drop constraint price_alerts_target_check,
--     drop constraint price_alerts_value_check, drop constraint price_alerts_timeframe_check,
--     drop constraint price_alerts_indicator_context, drop constraint price_alerts_periods_check,
--     drop constraint price_alerts_color_check,
--     drop constraint price_alerts_operator_check, add constraint price_alerts_operator_check check (operator in ('crosses_above', 'crosses_below')),
--     drop constraint price_alerts_status_check, add constraint price_alerts_status_check check (status in ('active', 'triggered')),
--     drop column source, drop column target, drop column timeframe, drop column periods, drop column color,
--     alter column value set not null;

begin;

alter table public.price_alerts
  add column source    text not null default 'price',
  add column target    text not null default 'value',
  add column timeframe text,
  add column periods   jsonb,
  add column color     text,
  alter column value drop not null;

alter table public.price_alerts
  drop constraint price_alerts_operator_check,
  add constraint price_alerts_operator_check check (operator in ('crosses_above', 'crosses_below', 'crosses')),
  drop constraint price_alerts_status_check,
  add constraint price_alerts_status_check check (status in ('active', 'triggered', 'unavailable')),
  add constraint price_alerts_source_check check (source in (
    'price',
    'ema20.ema20', 'ema50.ema50', 'ema200.ema200', 'rsi.rsi', 'macd.macd', 'macd.signal',
    'bollinger.upper', 'bollinger.middle', 'bollinger.lower', 'obv.obv', 'stochastic.k', 'stochastic.d',
    'adx.adx', 'adx.plusDI', 'adx.minusDI'
  )),
  add constraint price_alerts_target_check check (target <> source and target in (
    'value', 'price',
    'ema20.ema20', 'ema50.ema50', 'ema200.ema200', 'rsi.rsi', 'macd.macd', 'macd.signal',
    'bollinger.upper', 'bollinger.middle', 'bollinger.lower', 'obv.obv', 'stochastic.k', 'stochastic.d',
    'adx.adx', 'adx.plusDI', 'adx.minusDI'
  )),
  -- A value exactly when the target is one.
  add constraint price_alerts_value_check check ((target = 'value') = (value is not null)),
  add constraint price_alerts_timeframe_check check (timeframe in ('1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M')),
  -- The price against a value needs no candles; any condition with an indicator line needs both.
  add constraint price_alerts_indicator_context check (
    case when source = 'price' and target = 'value' then timeframe is null and periods is null
         else timeframe is not null and periods is not null end
  ),
  add constraint price_alerts_periods_check check (
    periods is null or (jsonb_typeof(periods) = 'object' and octet_length(periods::text) <= 512)
  ),
  add constraint price_alerts_color_check check (color ~ '^#[0-9A-Fa-f]{6}$');

commit;
