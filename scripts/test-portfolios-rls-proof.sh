#!/usr/bin/env bash
# Re-runnable RLS/limits proof for migration 040 in a THROWAWAY local postgres:15 container.
# Not run in CI. Needs docker. Never connects to Supabase: roles anon/authenticated and auth.uid() are stubs.
# Usage: scripts/test-portfolios-rls-proof.sh   (exit 0 = every assertion passed)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="pg040-proof-$$"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=x -v "$ROOT/supabase/migrations:/m:ro" postgres:15 >/dev/null
for _ in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 2
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q 2>&1 >/dev/null <<'SQL' | tee /tmp/pg040-proof.out
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid primary key);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
INSERT INTO auth.users VALUES ('aaaaaaaa-0000-0000-0000-000000000001'),('bbbbbbbb-0000-0000-0000-000000000002');
\i /m/040_test_portfolios.sql

-- assertion helpers (SECURITY INVOKER: they run as whichever role is active)
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
  IF stmt ~* '^\s*(update|delete)' THEN EXECUTE 'WITH q AS (' || stmt || ') SELECT count(*) FROM q' INTO got;
  ELSE EXECUTE 'SELECT count(*) FROM (' || stmt || ') q' INTO got; END IF;
  IF got <> want THEN RAISE EXCEPTION 'FAIL  % : got % rows, want %', label, got, want; END IF;
  RAISE NOTICE 'PASS  % (% rows)', label, got;
END $$;
GRANT EXECUTE ON FUNCTION expect_fail, expect_rows TO anon, authenticated;

\set A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set B '''bbbbbbbb-0000-0000-0000-000000000002'''
\set PA '''11111111-1111-1111-1111-111111111111'''
\set PB '''22222222-2222-2222-2222-222222222222'''

SET ROLE authenticated; SET test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
INSERT INTO test_portfolios (id,user_id,name) VALUES (:PA,:A,'Mi prueba');
INSERT INTO test_portfolio_items (portfolio_id,isin,input_mode,amount) VALUES (:PA,'AR0394353335','usd',10000);
UPDATE test_portfolio_items SET amount = 20000, input_mode = 'vn', manual_price = 99 WHERE isin = 'AR0394353335';
UPDATE test_portfolios SET name = 'Renombrada';
SELECT expect_rows('A owner CRUD: sees own portfolio + item', 'SELECT 1 FROM test_portfolios UNION ALL SELECT 1 FROM test_portfolio_items', 2);
SELECT expect_rows('item edit touches updated_at', 'SELECT 1 FROM test_portfolios WHERE updated_at > created_at', 1);
SELECT expect_fail('dup name (case-insens)', $q$INSERT INTO test_portfolios (user_id,name) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','RENOMBRADA')$q$, 'uq_test_portfolios_user_name');
SELECT expect_fail('dup ISIN', $q$INSERT INTO test_portfolio_items (portfolio_id,isin,input_mode,amount) VALUES ('11111111-1111-1111-1111-111111111111','AR0394353335','usd',1)$q$, 'portfolio_id_isin_key');
SELECT expect_fail('bad ISIN', $q$INSERT INTO test_portfolio_items (portfolio_id,isin,input_mode,amount) VALUES ('11111111-1111-1111-1111-111111111111','bad','usd',1)$q$, 'isin_check');
SELECT expect_fail('bad mode', $q$INSERT INTO test_portfolio_items (portfolio_id,isin,input_mode,amount) VALUES ('11111111-1111-1111-1111-111111111111','AR0585477562','eur',1)$q$, 'input_mode_check');
SELECT expect_fail('amount 0', $q$INSERT INTO test_portfolio_items (portfolio_id,isin,input_mode,amount) VALUES ('11111111-1111-1111-1111-111111111111','AR0585477562','usd',0)$q$, 'amount_check');
SELECT expect_fail('blank name', $q$INSERT INTO test_portfolios (user_id,name) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','   ')$q$, 'name_check');
SELECT expect_fail('61-char name', $q$INSERT INTO test_portfolios (user_id,name) VALUES ('aaaaaaaa-0000-0000-0000-000000000001',repeat('x',61))$q$, 'name_check');
SELECT expect_fail('A inserts a portfolio owned by B', $q$INSERT INTO test_portfolios (user_id,name) VALUES ('bbbbbbbb-0000-0000-0000-000000000002','robo')$q$, 'row-level security');

SET test.uid = 'bbbbbbbb-0000-0000-0000-000000000002';
SELECT expect_rows('B sees no portfolios', 'SELECT 1 FROM test_portfolios', 0);
SELECT expect_rows('B sees no items', 'SELECT 1 FROM test_portfolio_items', 0);
SELECT expect_rows('B update of A portfolio hits 0 rows', 'UPDATE test_portfolios SET name = ''hack'' RETURNING 1', 0);
SELECT expect_rows('B delete of A portfolio hits 0 rows', 'DELETE FROM test_portfolios RETURNING 1', 0);
SELECT expect_rows('B update of A item hits 0 rows', 'UPDATE test_portfolio_items SET amount = 1 RETURNING 1', 0);
SELECT expect_rows('B delete of A item hits 0 rows', 'DELETE FROM test_portfolio_items RETURNING 1', 0);
SELECT expect_fail('B inserts an item into A portfolio', $q$INSERT INTO test_portfolio_items (portfolio_id,isin,input_mode,amount) VALUES ('11111111-1111-1111-1111-111111111111','AR0585477562','usd',5)$q$, 'row-level security');
INSERT INTO test_portfolios (id,user_id,name) VALUES (:PB,:B,'B uno');
INSERT INTO test_portfolio_items (portfolio_id,isin,input_mode,amount) VALUES (:PB,'AR0585477562','usd',7);
SELECT expect_fail('B reassigns own portfolio to A immutable owner', $q$UPDATE test_portfolios SET user_id='aaaaaaaa-0000-0000-0000-000000000001' WHERE id='22222222-2222-2222-2222-222222222222'$q$, 'immutable_parent');
SELECT expect_fail('B moves own item into A portfolio', $q$UPDATE test_portfolio_items SET portfolio_id='11111111-1111-1111-1111-111111111111' WHERE portfolio_id='22222222-2222-2222-2222-222222222222'$q$);

RESET ROLE; SET ROLE anon; SET test.uid = '';
SELECT expect_fail('anon select portfolios', 'SELECT 1 FROM test_portfolios', 'permission denied');
SELECT expect_fail('anon insert portfolios', $q$INSERT INTO test_portfolios (user_id,name) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','anon')$q$, 'permission denied');
SELECT expect_fail('anon select items', 'SELECT 1 FROM test_portfolio_items', 'permission denied');

RESET ROLE; SET ROLE authenticated; SET test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
INSERT INTO test_portfolios (id,user_id,name) VALUES ('33333333-3333-3333-3333-333333333333','aaaaaaaa-0000-0000-0000-000000000001','small');
INSERT INTO test_portfolios (user_id,name) SELECT 'aaaaaaaa-0000-0000-0000-000000000001','p'||g FROM generate_series(1,18) g;
SELECT expect_rows('A has 20 portfolios', 'SELECT 1 FROM test_portfolios', 20);
SELECT expect_fail('21st portfolio', $q$INSERT INTO test_portfolios (user_id,name) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','p21')$q$, 'test_portfolio_limit');
INSERT INTO test_portfolio_items (portfolio_id,isin,input_mode,amount) SELECT '11111111-1111-1111-1111-111111111111','AR'||lpad(g::text,9,'0')||'0','vn',100 FROM generate_series(1,49) g;
SELECT expect_rows('A has 50 items in PA', 'SELECT 1 FROM test_portfolio_items WHERE portfolio_id = ''11111111-1111-1111-1111-111111111111''', 50);
SELECT expect_fail('51st item', $q$INSERT INTO test_portfolio_items (portfolio_id,isin,input_mode,amount) VALUES ('11111111-1111-1111-1111-111111111111','AR9999999990','vn',100)$q$, 'test_portfolio_item_limit');
-- limit bypass via re-parenting (the reviewed MEDIUM): move an item from a small portfolio into the full one
INSERT INTO test_portfolio_items (portfolio_id,isin,input_mode,amount) VALUES ('33333333-3333-3333-3333-333333333333','AR8888888880','usd',1);
SELECT expect_fail('limit bypass: move that item into the full portfolio', $q$UPDATE test_portfolio_items SET portfolio_id='11111111-1111-1111-1111-111111111111' WHERE isin='AR8888888880'$q$, 'immutable_parent');
UPDATE test_portfolio_items SET amount = 5 WHERE isin = 'AR8888888880';  -- normal edits still work
SELECT expect_rows('normal edit still works', 'SELECT 1 FROM test_portfolio_items WHERE isin=''AR8888888880'' AND amount=5', 1);
DELETE FROM test_portfolios WHERE id='11111111-1111-1111-1111-111111111111';
RESET ROLE;
SELECT expect_rows('cascade leaves no orphan items', 'SELECT 1 FROM test_portfolio_items WHERE portfolio_id = ''11111111-1111-1111-1111-111111111111''', 0);
SQL
echo "ALL ASSERTIONS PASSED"
