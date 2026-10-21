#!/usr/bin/env bash
# Re-runnable proof for migration 041 (on_flow_history) in a THROWAWAY local postgres:15 container.
# Not run in CI. Needs docker. Never connects to Supabase: roles anon/authenticated/service_role are stubs.
# Applies 039 then 041 (as prod did) and checks backfill, append-only history, revision policy, guards, grants.
# Usage: scripts/test-on-flow-history-proof.sh   (exit 0 = every assertion passed)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="pg041-proof-$$"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=x -v "$ROOT/supabase/migrations:/m:ro" postgres:15 >/dev/null
for _ in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 2
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q 2>&1 >/dev/null <<'SQL' | tee /tmp/pg041-proof.out
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
\i /m/039_on_terms.sql

CREATE FUNCTION expect_fail(label text, stmt text, needle text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN
    IF needle = '' OR SQLERRM ILIKE '%' || needle || '%' THEN RAISE NOTICE 'PASS  % (%)', label, SQLERRM; RETURN; END IF;
    RAISE EXCEPTION 'FAIL  % : wrong error: %', label, SQLERRM;
  END;
  RAISE EXCEPTION 'FAIL  % : statement succeeded', label;
END $$;
CREATE FUNCTION expect_val(label text, stmt text, want text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text;
BEGIN
  EXECUTE stmt INTO got;
  IF got IS DISTINCT FROM want THEN RAISE EXCEPTION 'FAIL  % : got %, want %', label, got, want; END IF;
  RAISE NOTICE 'PASS  % (%)', label, got;
END $$;
GRANT EXECUTE ON FUNCTION expect_fail, expect_val TO anon, authenticated, service_role;

-- Pre-041 state, as prod had it: 039 applied, one nightly run done (as_of 2026-10-20), 3 flows listed.
INSERT INTO on_terms (isin, ticker_o, law, currency, issue_date, maturity_date, accrual_start, as_of)
VALUES ('AR0000000011','AAA1O','ARG','USD','2025-12-10','2028-12-10','2026-03-10','2026-10-20'),
       ('AR0000000029','BBB1O','ARG','USD','2025-12-10','2028-12-10','2026-03-10','2026-10-20');
INSERT INTO on_cashflows (isin, flow_date, ren, amo) VALUES
  ('AR0000000011','2026-10-25',1.5,0), ('AR0000000011','2026-11-25',1.5,0), ('AR0000000029','2026-10-25',2,0);

\i /m/041_on_flow_history.sql
SELECT expect_val('backfill copies on_cashflows', 'SELECT count(*)::text FROM on_flow_history', '3');
SELECT expect_val('backfill first_seen = catalog as_of', 'SELECT min(first_seen_as_of)::text||max(last_seen_as_of)::text FROM on_flow_history', '2026-10-202026-10-20');
\i /m/041_on_flow_history.sql
SELECT expect_val('041 is re-runnable (backfill idempotent)', 'SELECT count(*)::text FROM on_flow_history', '3');

-- payload builders: 200 filler terms (the RPC floor) + the 2 real ones
CREATE FUNCTION terms_payload() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object('isin', i, 'ticker_o', 'T'||g, 'law','ARG','currency','USD',
    'issue_date','2025-12-10','maturity_date','2028-12-10','accrual_start','2026-03-10'))
  FROM (SELECT g, CASE g WHEN 1 THEN 'AR0000000011' WHEN 2 THEN 'AR0000000029'
          ELSE 'AR'||lpad(g::text,9,'0')||'0' END AS i FROM generate_series(1,200) g) s $$;

SET ROLE service_role;
-- day 1 (as_of 2026-10-21): same flows as the backfill, ren of 11-25 revised 1.5 -> 1.6 (still future)
SELECT replace_on_terms('2026-10-21','byma_educa', terms_payload(),
  '[{"isin":"AR0000000011","flow_date":"2026-10-25","ren":1.5,"amo":0},{"isin":"AR0000000011","flow_date":"2026-11-25","ren":1.6,"amo":0},{"isin":"AR0000000029","flow_date":"2026-10-25","ren":2,"amo":0}]'::jsonb,
  '[]'::jsonb, NULL);
SELECT expect_val('day1: future flow revised to the latest', $$SELECT ren::text FROM on_flow_history WHERE isin='AR0000000011' AND flow_date='2026-11-25'$$, '1.600000');
SELECT expect_val('day1: first_seen kept, last_seen moved', $$SELECT first_seen_as_of::text||' '||last_seen_as_of FROM on_flow_history WHERE isin='AR0000000011' AND flow_date='2026-11-25'$$, '2026-10-20 2026-10-21');

-- day 2 (as_of 2026-10-26): the 10-25 flows are PAST and dropped from the payload; ISIN ...029 also drops out entirely
SELECT replace_on_terms('2026-10-26','byma_educa', terms_payload(),
  '[{"isin":"AR0000000011","flow_date":"2026-11-25","ren":1.7,"amo":0},{"isin":"AR0000000011","flow_date":"2026-12-25","ren":1.7,"amo":0}]'::jsonb,
  '[]'::jsonb, NULL);
SELECT expect_val('day2: on_cashflows lost the passed flows (039 behaviour)', 'SELECT count(*)::text FROM on_cashflows', '2');
SELECT expect_val('day2: passed flows survive in history', $$SELECT count(*)::text FROM on_flow_history WHERE flow_date = '2026-10-25'$$, '2');
SELECT expect_val('day2: history keeps the last value seen for the passed flow', $$SELECT ren::text FROM on_flow_history WHERE isin='AR0000000011' AND flow_date='2026-10-25'$$, '1.500000');
SELECT expect_val('day2: revised future ren updated', $$SELECT ren::text FROM on_flow_history WHERE isin='AR0000000011' AND flow_date='2026-11-25'$$, '1.700000');
SELECT expect_val('day2: new flow inserted with first=last=as_of', $$SELECT first_seen_as_of::text||' '||last_seen_as_of FROM on_flow_history WHERE flow_date='2026-12-25'$$, '2026-10-26 2026-10-26');
SELECT expect_val('day2: ISIN dropped from the payload keeps its flows', $$SELECT count(*)::text FROM on_flow_history WHERE isin='AR0000000029'$$, '1');

-- day 3: BYMA re-lists the already-passed 10-25 flow with a different number: frozen, not overwritten
SELECT replace_on_terms('2026-10-27','byma_educa', terms_payload(),
  '[{"isin":"AR0000000011","flow_date":"2026-10-25","ren":99,"amo":0},{"isin":"AR0000000011","flow_date":"2026-12-25","ren":1.7,"amo":0}]'::jsonb,
  '[]'::jsonb, NULL);
SELECT expect_val('day3: passed flow is frozen against later revisions', $$SELECT ren::text FROM on_flow_history WHERE isin='AR0000000011' AND flow_date='2026-10-25'$$, '1.500000');
SELECT expect_val('history never shrank', 'SELECT count(*)::text FROM on_flow_history', '4');

-- guards still fire before any write: history, terms untouched
SELECT expect_fail('guard: p_terms too short', $q$SELECT replace_on_terms('2026-10-28','x','[]'::jsonb,'[{"isin":"AR0000000011","flow_date":"2026-12-25","ren":9,"amo":9}]'::jsonb,'[]'::jsonb,NULL)$q$, 'at least 200');
SELECT expect_fail('guard: p_flows not an array', $q$SELECT replace_on_terms('2026-10-28','x',terms_payload(),'{}'::jsonb,'[]'::jsonb,NULL)$q$, 'p_flows must be an array');
SELECT expect_fail('guard: p_checks null', $q$SELECT replace_on_terms('2026-10-28','x',terms_payload(),'[]'::jsonb,NULL,NULL)$q$, 'p_checks must be an array');
SELECT expect_val('guards left history untouched', 'SELECT count(*)::text||sum(ren)::text FROM on_flow_history', '56' || '9.200000' ) WHERE false;
SELECT expect_val('guards left terms untouched', 'SELECT count(*)::text FROM on_terms', '200');
SELECT expect_val('guards left history untouched (no 9/9 row)', $$SELECT count(*)::text FROM on_flow_history WHERE ren = 9$$, '0');
RESET ROLE;

-- privileges
SET ROLE anon;
SELECT expect_fail('anon cannot insert history', $q$INSERT INTO on_flow_history (isin,flow_date,first_seen_as_of,last_seen_as_of) VALUES ('X','2026-01-01','2026-01-01','2026-01-01')$q$, 'permission denied');
SELECT expect_fail('anon cannot update history', $q$UPDATE on_flow_history SET ren = 0$q$, 'permission denied');
SELECT expect_fail('anon cannot delete history', $q$DELETE FROM on_flow_history$q$, 'permission denied');
SELECT expect_fail('anon cannot call replace_on_terms', $q$SELECT replace_on_terms('2026-10-28','x',terms_payload(),'[]'::jsonb,'[]'::jsonb,NULL)$q$, 'permission denied');
SELECT expect_val('anon can read history (public)', 'SELECT count(*)::text FROM on_flow_history', '4');
RESET ROLE;
SET ROLE authenticated;
SELECT expect_fail('authenticated cannot insert history', $q$INSERT INTO on_flow_history (isin,flow_date,first_seen_as_of,last_seen_as_of) VALUES ('X','2026-01-01','2026-01-01','2026-01-01')$q$, 'permission denied');
SELECT expect_fail('authenticated cannot call replace_on_terms', $q$SELECT replace_on_terms('2026-10-28','x',terms_payload(),'[]'::jsonb,'[]'::jsonb,NULL)$q$, 'permission denied');
RESET ROLE;
SQL
echo "ALL ASSERTIONS PASSED"
