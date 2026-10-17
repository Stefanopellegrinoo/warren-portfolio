-- Migration 038: close 8 public tables that had RLS disabled
--
-- These tables are not Warren's: a separate nightly Python job (screening /
-- analysis) shares this Supabase project and owns them. With RLS off and the
-- default grants, anyone holding the anon key — which ships in Warren's public
-- frontend bundle — could read, modify or TRUNCATE them through PostgREST.
--
-- Enabling RLS with NO policies denies anon and authenticated. The external job
-- authenticates as service_role (verified in the API edge logs), which bypasses
-- RLS, so it keeps working unchanged.
--
-- Rollback: ALTER TABLE <name> DISABLE ROW LEVEL SECURITY; for each table.

ALTER TABLE alert_log            ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidatos_screener  ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate2_snapshots      ENABLE ROW LEVEL SECURITY;
ALTER TABLE paises_em            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sector_benchmarks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_state         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticker_tema          ENABLE ROW LEVEL SECURITY;
