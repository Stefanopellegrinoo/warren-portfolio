#!/usr/bin/env bash
# Re-runnable proof for migration 055 (odd/tasks/deposit-dates.md T3) in a THROWAWAY local postgres:15 container.
# Not run in CI. Needs docker. Never connects to Supabase: roles anon/authenticated and auth.uid() are stubs.
# Usage: scripts/test-redate-deposits-proof.sh   (exit 0 = every assertion passed)
set -euo pipefail
ROOT="${ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
NAME="pg055-proof-$$"
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
-- cash_movements as 003 + 008 (transaction_id) + 015 (types) leave it, with its one RLS policy.
CREATE TABLE public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  date date not null,
  type text not null check (type in ('DEPOSITO','RETIRO','CUPON','DIVIDENDO','COMPRA','VENTA')),
  amount numeric(18,4) not null,
  description text,
  ticker text,
  transaction_id uuid,
  created_at timestamptz default now()
);
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_cash_movements" ON public.cash_movements FOR ALL USING (auth.uid() = user_id);
\i /m/055_redate_deposits.sql

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
GRANT EXECUTE ON FUNCTION expect_fail, expect_eq TO anon, authenticated;

-- A: purchase legs in 2022 (linked), a lump deposit of 3000 on 2026-03-31 and one of 1000 on 2026-04-09.
INSERT INTO public.cash_movements (id, user_id, date, type, amount, transaction_id) VALUES
  ('11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '2022-02-09', 'RETIRO', 500, gen_random_uuid()),
  ('11111111-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-03-31', 'DEPOSITO', 3000, NULL),
  ('11111111-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-04-09', 'DEPOSITO', 1000, NULL),
  ('11111111-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-04-10', 'DEPOSITO', 70, gen_random_uuid()),
  ('22222222-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', '2026-03-31', 'DEPOSITO', 999, NULL);
CREATE VIEW totals AS SELECT user_id, sum(amount) FILTER (WHERE type = 'DEPOSITO' AND transaction_id IS NULL) AS deposited, count(*) AS n
  FROM public.cash_movements GROUP BY user_id;
GRANT SELECT ON totals TO authenticated;

-- Nobody signed in, anon, an empty plan
SET ROLE authenticated;
SELECT expect_fail('no signed-in user', $q$SELECT redate_deposits('[{"id":"11111111-0000-0000-0000-000000000002","parts":[{"date":"2022-02-09","amount":500}]}]')$q$, 'no signed-in user');
RESET ROLE; SET ROLE anon; SET test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT expect_fail('anon cannot execute', $q$SELECT redate_deposits('[]')$q$, 'permission denied');
RESET ROLE; SET ROLE authenticated; SET test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT expect_fail('an empty plan', $q$SELECT redate_deposits('[]')$q$, 'no changes');

-- Refusals write nothing
SELECT expect_fail('another user''s deposit', $q$SELECT redate_deposits('[{"id":"22222222-0000-0000-0000-000000000001","parts":[{"date":"2022-02-09","amount":1}]}]')$q$, 'not found');
SELECT expect_fail('a deposit a trade wrote', $q$SELECT redate_deposits('[{"id":"11111111-0000-0000-0000-000000000004","parts":[{"date":"2022-02-09","amount":1}]}]')$q$, 'not found');
SELECT expect_fail('a purchase leg', $q$SELECT redate_deposits('[{"id":"11111111-0000-0000-0000-000000000001","parts":[{"date":"2022-01-09","amount":1}]}]')$q$, 'not found');
SELECT expect_fail('parts over the deposit', $q$SELECT redate_deposits('[{"id":"11111111-0000-0000-0000-000000000002","parts":[{"date":"2022-02-09","amount":3000.01}]}]')$q$, 'exceed');
SELECT expect_fail('a part on the deposit''s own day', $q$SELECT redate_deposits('[{"id":"11111111-0000-0000-0000-000000000002","parts":[{"date":"2026-03-31","amount":1}]}]')$q$, 'not dated before');
SELECT expect_fail('a zero part', $q$SELECT redate_deposits('[{"id":"11111111-0000-0000-0000-000000000002","parts":[{"date":"2022-02-09","amount":0}]}]')$q$, 'not positive');
SELECT expect_fail('a deposit without parts', $q$SELECT redate_deposits('[{"id":"11111111-0000-0000-0000-000000000002","parts":[]}]')$q$, 'no parts');
-- one good change and one bad one: the good one is not kept either
SELECT expect_fail('all or nothing', $q$SELECT redate_deposits('[{"id":"11111111-0000-0000-0000-000000000002","parts":[{"date":"2022-02-09","amount":500}]},{"id":"11111111-0000-0000-0000-000000000003","parts":[{"date":"2026-04-09","amount":1}]}]')$q$, 'not dated before');
SELECT expect_eq('after every refusal nothing changed',
  (SELECT jsonb_agg(jsonb_build_array(date, type, amount) ORDER BY date, amount) FROM public.cash_movements),
  '[["2022-02-09","RETIRO",500.0000],["2026-03-31","DEPOSITO",3000.0000],["2026-04-09","DEPOSITO",1000.0000],["2026-04-10","DEPOSITO",70.0000]]');

-- A splits the 03-31 lump in two parts and gives the whole 04-09 one to a single earlier day
SELECT expect_eq('returns the deposits inserted',
  to_jsonb(redate_deposits('[{"id":"11111111-0000-0000-0000-000000000002","parts":[{"date":"2022-02-09","amount":500},{"date":"2023-05-02","amount":1234.5678}]},{"id":"11111111-0000-0000-0000-000000000003","parts":[{"date":"2026-04-01","amount":1000}]}]')),
  '3');
SELECT expect_eq('the parts are deposits on their days; the lump keeps the rest; a lump given away is gone',
  (SELECT jsonb_agg(jsonb_build_array(date, type, amount, description) ORDER BY date, amount) FROM public.cash_movements WHERE type = 'DEPOSITO' AND transaction_id IS NULL),
  '[["2022-02-09","DEPOSITO",500.0000,"Parte del depósito del 31/03/2026"],["2023-05-02","DEPOSITO",1234.5678,"Parte del depósito del 31/03/2026"],["2026-03-31","DEPOSITO",1265.4322,null],["2026-04-01","DEPOSITO",1000.0000,"Parte del depósito del 09/04/2026"]]');
SELECT expect_eq('the total deposited did not change',
  (SELECT to_jsonb(deposited) FROM totals WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), '4000.0000');
SELECT expect_eq('the trade legs were not touched',
  (SELECT jsonb_agg(jsonb_build_array(date, type, amount) ORDER BY date) FROM public.cash_movements WHERE transaction_id IS NOT NULL),
  '[["2022-02-09","RETIRO",500.0000],["2026-04-10","DEPOSITO",70.0000]]');
-- A rounding half a cent over the deposit is accepted and leaves nothing behind
SELECT expect_eq('half a cent of rounding over the rest: the lump is gone, nothing negative',
  to_jsonb(redate_deposits('[{"id":"11111111-0000-0000-0000-000000000002","parts":[{"date":"2024-01-02","amount":1265.4362}]}]')), '1');
SELECT expect_eq('no lump left on 2026-03-31 and no negative deposit',
  (SELECT to_jsonb(count(*)) FROM public.cash_movements WHERE date = '2026-03-31' OR amount < 0), '0');

-- B never saw A's rows, and A's call left B's deposit as it was
RESET ROLE; SET ROLE authenticated; SET test.uid = 'bbbbbbbb-0000-0000-0000-000000000002';
SELECT expect_eq('B sees only its own deposit, unchanged',
  (SELECT jsonb_agg(jsonb_build_array(date, amount)) FROM public.cash_movements), '[["2026-03-31",999.0000]]');
SQL
echo "055 proof: every assertion passed"
