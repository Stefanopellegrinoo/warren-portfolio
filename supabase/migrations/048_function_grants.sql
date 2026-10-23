-- Migration 048: function grants (odd/tasks/security-hardening.md T4, S4).
--
-- Postgres grants EXECUTE to PUBLIC by default, so the public anon key could call
-- every write function through /rest/v1/rpc. The worst case was
-- update_setup_performance_atomic: SECURITY DEFINER (RLS bypassed), it takes
-- p_user_id from the caller, and anon could execute it, so anyone could write
-- setup_performance rows for any user without signing in.
--
-- Who calls what (verified in src/ on 2026-10-23):
--   update_setup_performance_atomic   signals worker, service-role client
--   import_transactions_atomic        import worker, service-role client
--   replace_portfolio_atomic          import worker, service-role client
--   process_transaction_atomic        API routes, signed-in user's client (uses auth.uid())
-- The service role bypasses RLS, so update_setup_performance_atomic needs no
-- SECURITY DEFINER. Every REVOKE ... FROM PUBLIC is followed by an explicit GRANT,
-- because a role's EXECUTE may come only from PUBLIC.
--
-- Grants only: no data or table changes. Safe to apply before or after the deploy.
-- Rollback: GRANT EXECUTE ... TO PUBLIC on the four functions (and SECURITY DEFINER).

BEGIN;

ALTER FUNCTION public.update_setup_performance_atomic(uuid, uuid, uuid, text, numeric, numeric)
  SECURITY INVOKER SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.update_setup_performance_atomic(uuid, uuid, uuid, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_setup_performance_atomic(uuid, uuid, uuid, text, numeric, numeric) TO service_role;

REVOKE EXECUTE ON FUNCTION public.import_transactions_atomic(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_transactions_atomic(uuid, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.replace_portfolio_atomic(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_portfolio_atomic(uuid, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.process_transaction_atomic(date, text, text, numeric, numeric, numeric, text, text, text, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_transaction_atomic(date, text, text, numeric, numeric, numeric, text, text, text, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, date, text) TO authenticated, service_role;

COMMIT;
