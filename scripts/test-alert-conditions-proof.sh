#!/usr/bin/env bash
# Re-runnable proof for migration 052 in a THROWAWAY local postgres:15 container: rows and writes from before
# keep their meaning, the new conditions are accepted, and the new CHECKs refuse bad values.
# Not run in CI. Needs docker. Never connects to Supabase: roles and auth.uid() are stubs.
# Usage: scripts/test-alert-conditions-proof.sh   (exit 0 = every assertion passed)
set -euo pipefail
ROOT="${ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
NAME="pg052-proof-$$"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=x -v "$ROOT/supabase/migrations:/m:ro" postgres:15 >/dev/null
for _ in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 2
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q 2>&1 >/dev/null <<'SQL'
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid primary key);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
INSERT INTO auth.users VALUES ('aaaaaaaa-0000-0000-0000-000000000001'),('bbbbbbbb-0000-0000-0000-000000000002');
\i /m/026_price_alerts.sql

-- Rows written before 052, the way the app writes them.
INSERT INTO price_alerts (id, user_id, ticker, type, operator, value, name) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'AAPL', 'price', 'crosses_above', 195, 'AAPL cruza por encima de 195,00'),
  ('00000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000001', 'BTCUSDT', 'price', 'crosses_below', 0.1235, 'x');
UPDATE price_alerts SET status = 'triggered', triggered_at = now() WHERE id = '00000000-0000-0000-0000-0000000000a2';

\i /m/052_alert_conditions.sql

CREATE FUNCTION expect_fail(label text, stmt text, needle text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN
    IF needle = '' OR SQLERRM ILIKE '%' || needle || '%' THEN RAISE NOTICE 'PASS  % (%)', label, SQLERRM; RETURN; END IF;
    RAISE EXCEPTION 'FAIL  % : wrong error: %', label, SQLERRM;
  END;
  RAISE EXCEPTION 'FAIL  % : statement succeeded', label;
END $$;
CREATE FUNCTION expect_rows(label text, stmt text, want bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE got bigint;
BEGIN
  IF stmt ~* '^\s*(insert|update|delete)' THEN EXECUTE 'WITH q AS (' || stmt || ') SELECT count(*) FROM q' INTO got;
  ELSE EXECUTE 'SELECT count(*) FROM (' || stmt || ') q' INTO got; END IF;
  IF got <> want THEN RAISE EXCEPTION 'FAIL  % : got % rows, want %', label, got, want; END IF;
  RAISE NOTICE 'PASS  % (% rows)', label, got;
END $$;
-- An insert as A with the given columns.
CREATE FUNCTION ins(cols text, vals text) RETURNS text LANGUAGE sql AS $$
  SELECT format('INSERT INTO price_alerts (user_id, ticker, name, %s) VALUES (%L, %L, %L, %s)', cols, 'aaaaaaaa-0000-0000-0000-000000000001', 'FXI', 'n', vals)
$$;
GRANT EXECUTE ON FUNCTION expect_fail, expect_rows, ins TO anon, authenticated;

-- Old rows mean what they meant: the price against their value, up or down, no context, no color.
SELECT expect_rows('old rows read as the price against their value', $q$SELECT 1 FROM price_alerts WHERE source = 'price' AND target = 'value'
  AND timeframe IS NULL AND periods IS NULL AND color IS NULL AND value IN (195, 0.1235) AND operator IN ('crosses_above', 'crosses_below')$q$, 2);
SELECT expect_rows('old statuses kept', $q$SELECT 1 FROM price_alerts WHERE (ticker, status) IN (('AAPL', 'active'), ('BTCUSDT', 'triggered'))$q$, 2);

SET ROLE authenticated; SET test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
-- An old client's writes: the same columns as before.
SELECT expect_rows('old insert', $q$INSERT INTO price_alerts (user_id, ticker, type, operator, value, name)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'GGAL', 'price', 'crosses_above', 4.2, 'GGAL cruza por encima de 4,20')
  RETURNING source, target, timeframe, periods, color$q$, 1);
SELECT expect_rows('old insert gets the old meaning', $q$SELECT 1 FROM price_alerts WHERE ticker = 'GGAL' AND source = 'price' AND target = 'value' AND timeframe IS NULL AND periods IS NULL AND color IS NULL$q$, 1);
SELECT expect_rows('old move', $q$UPDATE price_alerts SET value = 200, operator = 'crosses_below', name = 'n' WHERE ticker = 'AAPL' RETURNING 1$q$, 1);
SELECT expect_rows('old rearm', $q$UPDATE price_alerts SET status = 'active', triggered_at = NULL WHERE ticker = 'BTCUSDT' RETURNING 1$q$, 1);

-- The new conditions.
SELECT expect_rows('price crosses a value either way, with a color', $q$INSERT INTO price_alerts (user_id, ticker, operator, value, name, color)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'FXI', 'crosses', 32.5, 'n', '#f23645') RETURNING 1$q$, 1);
SELECT expect_rows('price crosses EMA 50', $q$INSERT INTO price_alerts (user_id, ticker, operator, value, name, source, target, timeframe, periods)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'FXI', 'crosses', NULL, 'n', 'price', 'ema50.ema50', '1d', '{"ema50": 50}') RETURNING 1$q$, 1);
SELECT expect_rows('RSI 14 crosses 70 up on 1h', $q$INSERT INTO price_alerts (user_id, ticker, operator, value, name, source, target, timeframe, periods)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'FXI', 'crosses_above', 70, 'n', 'rsi.rsi', 'value', '1h', '{"rsi": 14}') RETURNING 1$q$, 1);
SELECT expect_rows('EMA 20 crosses EMA 50', $q$INSERT INTO price_alerts (user_id, ticker, operator, value, name, source, target, timeframe, periods)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'FXI', 'crosses_below', NULL, 'n', 'ema20.ema20', 'ema50.ema50', '4h', '{"ema20": 20, "ema50": 50}') RETURNING 1$q$, 1);
SELECT expect_rows('OBV crosses the price, with no periods', $q$INSERT INTO price_alerts (user_id, ticker, operator, value, name, source, target, timeframe, periods)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'FXI', 'crosses', NULL, 'n', 'obv.obv', 'price', '1w', '{}') RETURNING 1$q$, 1);
SELECT expect_rows('the worker can mark one "No se puede revisar"', $q$UPDATE price_alerts SET status = 'unavailable' WHERE source = 'rsi.rsi' RETURNING 1$q$, 1);

-- What the CHECKs refuse.
SELECT expect_fail('unknown operator', ins('operator, value', $v$'above', 1$v$), 'price_alerts_operator_check');
SELECT expect_fail('unknown status', ins('operator, value, status', $v$'crosses', 1, 'paused'$v$), 'price_alerts_status_check');
SELECT expect_fail('unknown source line', ins('operator, value, source, timeframe, periods', $v$'crosses', 1, 'rsi.signal', '1d', '{}'$v$), 'price_alerts_source_check');
SELECT expect_fail('a histogram is not a line', ins('operator, value, source, timeframe, periods', $v$'crosses', 1, 'macd.histogram', '1d', '{}'$v$), 'price_alerts_source_check');
SELECT expect_fail('unknown target line', ins('operator, value, target, timeframe, periods', $v$'crosses', NULL, 'sma50.sma50', '1d', '{}'$v$), 'price_alerts_target_check');
SELECT expect_fail('a line against itself', ins('operator, value, source, target, timeframe, periods', $v$'crosses', NULL, 'ema50.ema50', 'ema50.ema50', '1d', '{}'$v$), 'price_alerts_target_check');
SELECT expect_fail('against a value with no value', ins('operator, value', $v$'crosses', NULL$v$), 'price_alerts_value_check');
SELECT expect_fail('against a line with a value', ins('operator, value, target, timeframe, periods', $v$'crosses', 5, 'ema50.ema50', '1d', '{"ema50": 50}'$v$), 'price_alerts_value_check');
SELECT expect_fail('an indicator with no timeframe', ins('operator, value, source, periods', $v$'crosses', 70, 'rsi.rsi', '{"rsi": 14}'$v$), 'price_alerts_indicator_context');
SELECT expect_fail('an indicator with no periods', ins('operator, value, source, timeframe', $v$'crosses', 70, 'rsi.rsi', '1h'$v$), 'price_alerts_indicator_context');
SELECT expect_fail('the price against a value with a timeframe', ins('operator, value, timeframe', $v$'crosses', 1, '1d'$v$), 'price_alerts_indicator_context');
SELECT expect_fail('unknown timeframe', ins('operator, value, source, timeframe, periods', $v$'crosses', 70, 'rsi.rsi', '2h', '{"rsi": 14}'$v$), 'price_alerts_timeframe_check');
SELECT expect_fail('periods that are not an object', ins('operator, value, source, timeframe, periods', $v$'crosses', 70, 'rsi.rsi', '1h', '[14]'$v$), 'price_alerts_periods_check');
SELECT expect_fail('periods over 512 bytes', ins('operator, value, source, timeframe, periods', $v$'crosses', 70, 'rsi.rsi', '1h', jsonb_build_object('rsi', repeat('1', 600))$v$), 'price_alerts_periods_check');
SELECT expect_fail('a color that is not #rrggbb', ins('operator, value, color', $v$'crosses', 1, 'red'$v$), 'price_alerts_color_check');
SELECT expect_fail('a short color', ins('operator, value, color', $v$'crosses', 1, '#f00'$v$), 'price_alerts_color_check');
SELECT expect_fail('moving a line target to a value by hand breaks the pair', $q$UPDATE price_alerts SET value = 30 WHERE target = 'ema50.ema50'$q$, 'price_alerts_value_check');

-- RLS as before: B sees and changes none of A's alerts.
SET test.uid = 'bbbbbbbb-0000-0000-0000-000000000002';
SELECT expect_rows('B sees no alert of A', 'SELECT 1 FROM price_alerts', 0);
SELECT expect_rows('B update of A hits 0 rows', $q$UPDATE price_alerts SET color = '#2962ff' RETURNING 1$q$, 0);
SELECT expect_fail('B writes an alert as A', ins('operator, value', $v$'crosses', 1$v$), 'row-level security');
RESET ROLE;
SELECT expect_rows('A keeps every alert', 'SELECT 1 FROM price_alerts', 8);
SQL
echo "ALL ASSERTIONS PASSED"
