#!/usr/bin/env bash
# Re-runnable RLS/merge proof for migration 051 in a THROWAWAY local postgres:15 container.
# Not run in CI. Needs docker. Never connects to Supabase: roles anon/authenticated and auth.uid() are stubs.
# Usage: scripts/test-chart-preferences-rls-proof.sh   (exit 0 = every assertion passed)
set -euo pipefail
ROOT="${ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
NAME="pg051-proof-$$"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=x -v "$ROOT/supabase/migrations:/m:ro" postgres:15 >/dev/null
for _ in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 2
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q 2>&1 >/dev/null <<'SQL'
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid primary key);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
-- Supabase grants new tables AND functions to anon/authenticated directly, not only through PUBLIC.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
INSERT INTO auth.users VALUES ('aaaaaaaa-0000-0000-0000-000000000001'),('bbbbbbbb-0000-0000-0000-000000000002');
-- set_updated_at comes from 027
CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN new.updated_at = now(); RETURN new; END $$;
\i /m/051_chart_preferences.sql

CREATE FUNCTION expect_fail(label text, stmt text, needle text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN
    IF needle = '' OR SQLERRM ILIKE '%' || needle || '%' THEN RAISE NOTICE 'PASS  % (%)', label, SQLERRM; RETURN; END IF;
    RAISE EXCEPTION 'FAIL  % : wrong error: %', label, SQLERRM;
  END;
  RAISE EXCEPTION 'FAIL  % : statement succeeded', label;
END $$;
CREATE FUNCTION expect_eq(label text, got jsonb, want jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN RAISE EXCEPTION 'FAIL  % : got %, want %', label, got, want; END IF;
  RAISE NOTICE 'PASS  %', label;
END $$;
CREATE FUNCTION expect_rows(label text, stmt text, want bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE got bigint;
BEGIN
  IF stmt ~* '^\s*(update|delete)' THEN EXECUTE 'WITH q AS (' || stmt || ') SELECT count(*) FROM q' INTO got;
  ELSE EXECUTE 'SELECT count(*) FROM (' || stmt || ') q' INTO got; END IF;
  IF got <> want THEN RAISE EXCEPTION 'FAIL  % : got % rows, want %', label, got, want; END IF;
  RAISE NOTICE 'PASS  % (% rows)', label, got;
END $$;
GRANT EXECUTE ON FUNCTION expect_fail, expect_eq, expect_rows TO anon, authenticated;
CREATE VIEW mine WITH (security_invoker = true) AS SELECT favorites, tool_styles, indicator_settings FROM public.chart_preferences;
GRANT SELECT ON mine TO authenticated;

-- A writes per section and per key
SET ROLE authenticated; SET test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT patch_chart_preferences('{"ray": true, "rectangle": true}', '{"ray": {"color": "#f23645"}}', '{}');
SELECT expect_rows('A has one row', 'SELECT 1 FROM chart_preferences', 1);
SELECT patch_chart_preferences('{}', '{"parallel-channel": {"fillBackground": false}}', '{"rsi": {"values": {"rsi": 21}}}');
SELECT expect_eq('another section and another key keep what was there',
  (SELECT to_jsonb(m) FROM mine m),
  '{"favorites": {"ray": true, "rectangle": true}, "tool_styles": {"ray": {"color": "#f23645"}, "parallel-channel": {"fillBackground": false}}, "indicator_settings": {"rsi": {"values": {"rsi": 21}}}}');
SELECT patch_chart_preferences('{"ray": null}', '{"ray": {"color": "#2962ff", "width": 2}}', '{"rsi": null}');
SELECT expect_eq('a null removes its key, a value replaces its key, the rest stays',
  (SELECT to_jsonb(m) FROM mine m),
  '{"favorites": {"rectangle": true}, "tool_styles": {"ray": {"color": "#2962ff", "width": 2}, "parallel-channel": {"fillBackground": false}}, "indicator_settings": {}}');
SELECT patch_chart_preferences();
SELECT expect_rows('a patch with nothing changes nothing', 'SELECT 1 FROM chart_preferences WHERE favorites = ''{"rectangle": true}''', 1);
SELECT expect_rows('an update touches updated_at', 'SELECT 1 FROM chart_preferences WHERE updated_at > created_at', 1);
SELECT expect_fail('a section that is not an object', $q$SELECT patch_chart_preferences('["ray"]')$q$, 'chart_preferences_objects');
SELECT expect_fail('a scalar section', $q$SELECT patch_chart_preferences('{}', '5')$q$, 'chart_preferences_objects');
SELECT expect_fail('a column over 128 KB', $q$SELECT patch_chart_preferences('{}', jsonb_build_object('ray', jsonb_build_object('text', repeat('x', 140000))))$q$, 'chart_preferences_size');
SELECT expect_fail('direct insert for B', $q$INSERT INTO chart_preferences (user_id) VALUES ('bbbbbbbb-0000-0000-0000-000000000002')$q$, 'row-level security');

-- B cannot see or change A's row, and gets its own
SET test.uid = 'bbbbbbbb-0000-0000-0000-000000000002';
SELECT expect_rows('B sees no row of A', 'SELECT 1 FROM chart_preferences', 0);
SELECT expect_rows('B update of A hits 0 rows', 'UPDATE chart_preferences SET favorites = ''{}'' RETURNING 1', 0);
SELECT expect_rows('B delete of A hits 0 rows', 'DELETE FROM chart_preferences RETURNING 1', 0);
SELECT patch_chart_preferences('{"text": true}');
SELECT expect_eq('B patch writes only B row', (SELECT to_jsonb(m) FROM mine m), '{"favorites": {"text": true}, "tool_styles": {}, "indicator_settings": {}}');
SELECT expect_fail('B moves its row to A', $q$UPDATE chart_preferences SET user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$q$, 'row-level security');

-- signed out: no session, no rows, no function
RESET ROLE; SET ROLE authenticated; SET test.uid = '';
SELECT expect_fail('authenticated role without a uid cannot write', $q$SELECT patch_chart_preferences('{"ray": true}')$q$, 'row-level security');
RESET ROLE; SET ROLE anon;
SELECT expect_fail('anon cannot call the function', $q$SELECT patch_chart_preferences('{"ray": true}')$q$, 'permission denied');
SELECT expect_rows('anon sees no rows', 'SELECT 1 FROM chart_preferences', 0);

RESET ROLE;
SELECT expect_rows('A row untouched by B', 'SELECT 1 FROM chart_preferences WHERE user_id = ''aaaaaaaa-0000-0000-0000-000000000001'' AND favorites = ''{"rectangle": true}''', 1);
DELETE FROM auth.users WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT expect_rows('deleting the user deletes the row', 'SELECT 1 FROM chart_preferences WHERE user_id = ''aaaaaaaa-0000-0000-0000-000000000001''', 0);
SQL
echo "ALL ASSERTIONS PASSED"
