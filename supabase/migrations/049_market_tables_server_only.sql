-- Migration 049: market and reference tables readable only by the server
-- (odd/tasks/security-hardening.md T12, S12).
--
-- The anon key ships in the public JS bundle. With it, anyone could read these 13
-- tables straight from PostgREST, with no login and none of the API rate limits.
-- Measured 2026-10-23: on_terms 260 rows, on_flow_history 1531, on_price_history 2288,
-- on_cashflows 1519, and so on. Any signed-up user could do the same with their JWT.
-- The browser never reads tables directly (everything goes through /api), and after
-- T12 the server reads them only with the service role, which bypasses RLS and keeps
-- its own grants. User tables are untouched: RLS on auth.uid() stays their guard.
--
-- RUN ORDER (dev and prod share one Supabase):
--   1. Deploy the T12 code (server reads with the service role).
--   2. Check that pg_stat_statements shows no new anon/authenticated reads of these
--      tables over a window of real use. Any delta is a missed call site.
--   3. With the user's explicit OK, apply this file.
-- ROLLBACK: recreate each "<table> read" policy (FOR SELECT USING (true); roles as before:
-- public for activos, cedears, ons and the on_* tables; authenticated for fx_rates and
-- ticker_identity) and GRANT SELECT ON the 13 tables TO anon, authenticated.

BEGIN;

DROP POLICY IF EXISTS "Allow read activos" ON public.activos;
DROP POLICY IF EXISTS "Allow read cedears" ON public.cedears;
DROP POLICY IF EXISTS fx_rates_read ON public.fx_rates;
DROP POLICY IF EXISTS on_cashflows_read_all ON public.on_cashflows;
DROP POLICY IF EXISTS on_corporate_events_read_all ON public.on_corporate_events;
DROP POLICY IF EXISTS on_flow_history_read_all ON public.on_flow_history;
DROP POLICY IF EXISTS on_price_history_read_all ON public.on_price_history;
DROP POLICY IF EXISTS on_sov_curve_read_all ON public.on_sov_curve;
DROP POLICY IF EXISTS on_terms_read_all ON public.on_terms;
DROP POLICY IF EXISTS on_terms_overrides_read_all ON public.on_terms_overrides;
DROP POLICY IF EXISTS on_yield_checks_read_all ON public.on_yield_checks;
DROP POLICY IF EXISTS ons_read_all ON public.ons;
DROP POLICY IF EXISTS ticker_identity_read ON public.ticker_identity;

-- Grants too, so a future permissive policy cannot silently reopen them.
REVOKE ALL ON TABLE public.activos, public.cedears, public.fx_rates, public.on_cashflows,
  public.on_corporate_events, public.on_flow_history, public.on_price_history,
  public.on_sov_curve, public.on_terms, public.on_terms_overrides, public.on_yield_checks,
  public.ons, public.ticker_identity FROM anon, authenticated;

COMMIT;
