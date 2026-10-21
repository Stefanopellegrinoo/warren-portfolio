-- Migration 039: ON terms catalog, raw cashflows, daily yield checks, sovereign
-- curve, curated overrides and corporate events.
--
-- Global, not per-user: terms of a bond do not depend on who holds it. No FK
-- to `ons`. All 6 tables: RLS in this same migration, 037 shape (public read,
-- service_role write). Nothing here is writable by anon or authenticated.
--
-- Ingestion (nightly BYMA Educa job, service_role) writes ONLY on_terms,
-- on_cashflows, on_yield_checks and on_sov_curve, through replace_on_terms().
-- It stores BYMA's RAW numbers; nothing derived (flows, yields) is persisted.
-- on_terms_overrides and on_corporate_events are curated and written ONLY by
-- migrations; corrections ship as new migrations.
--
-- Day count, business-day conventions, record date, lots, calls and puts are
-- NOT BYMA fields: they live in on_terms_overrides (per-field provenance), and
-- the resolver falls back to a per-law default marked "sin verificar".
-- There is deliberately no min_lot column.
--
-- ADTV units (measured on the BYMA 2026-10-20 payload, 183 USD ONs): `adtv` is
-- ARS cash, `adtvp` is USD cash per line [O, D, C]; adtv / fx / adtvp[O] has
-- median 0.996 and does not move with price (nominal volume would), so
-- adtv_* here are USD cash, not nominal.

-- ---------------------------------------------------------------- on_terms
CREATE TABLE IF NOT EXISTS on_terms (
  isin               TEXT PRIMARY KEY,
  ticker_o           TEXT NOT NULL,
  ticker_d           TEXT,
  ticker_c           TEXT,
  issuer             TEXT,
  description        TEXT,
  law                TEXT NOT NULL CHECK (law IN ('ARG', 'NY')),
  currency           TEXT NOT NULL,
  payment_plaza      TEXT CHECK (payment_plaza IN ('MEP', 'CCL', 'ARS')),
  est                TEXT,
  frequency          TEXT,
  issue_date         DATE NOT NULL,
  maturity_date      DATE NOT NULL,
  coupon_rate        NUMERIC(10,6),
  residual_pct       NUMERIC(10,4) NOT NULL DEFAULT 100,
  accrual_start      DATE NOT NULL,
  issued_amount_byma NUMERIC(20,2),
  adtv_o             NUMERIC(20,2),
  adtv_d             NUMERIC(20,2),
  adtv_c             NUMERIC(20,2),
  as_of              DATE NOT NULL,
  source             TEXT NOT NULL DEFAULT 'byma_educa',
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN on_terms.coupon_rate IS 'BYMA cup as a fraction (0.0725 = 7.25%); NULL for zero-coupon';
COMMENT ON COLUMN on_terms.residual_pct IS 'BYMA vr: residual value still outstanding, % of original VN';
COMMENT ON COLUMN on_terms.accrual_start IS 'Start of the accrual period holding the first listed flow (BYMA ren lists future flows only)';
COMMENT ON COLUMN on_terms.issued_amount_byma IS 'BYMA mto: unreliable (stale after reopenings); the issued_amount override wins';

-- ------------------------------------------------------------ on_cashflows
CREATE TABLE IF NOT EXISTS on_cashflows (
  isin      TEXT NOT NULL REFERENCES on_terms(isin) ON DELETE CASCADE,
  flow_date DATE NOT NULL,
  ren       NUMERIC(14,6) NOT NULL DEFAULT 0,
  amo       NUMERIC(14,6) NOT NULL DEFAULT 0,
  PRIMARY KEY (isin, flow_date)
);

COMMENT ON TABLE on_cashflows IS 'Raw BYMA ren (coupon, scaled to the residual) and amo (% of original VN), unadjusted dates, future flows only';

-- --------------------------------------------------------- on_yield_checks
CREATE TABLE IF NOT EXISTS on_yield_checks (
  isin           TEXT NOT NULL,
  as_of          DATE NOT NULL,
  byma_px        NUMERIC(14,4),
  byma_ytm       NUMERIC(10,4),
  method_ytm     NUMERIC(10,4),
  method_diff_bp NUMERIC(10,2),
  terms_ytm      NUMERIC(10,4),
  terms_diff_bp  NUMERIC(10,2),
  flagged        BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (isin, as_of)
);

COMMENT ON COLUMN on_yield_checks.method_diff_bp IS 'Our solver on BYMA flows vs BYMA ytm; the only check that is flagged';
COMMENT ON COLUMN on_yield_checks.terms_diff_bp IS 'Our resolved terms at BYMA px; informational, never flagged';

-- ------------------------------------------------------------ on_sov_curve
CREATE TABLE IF NOT EXISTS on_sov_curve (
  ticker TEXT PRIMARY KEY,
  isin   TEXT,
  law    TEXT NOT NULL CHECK (law IN ('ARG', 'NY')),
  px     NUMERIC(14,4),
  ytm    NUMERIC(10,4) NOT NULL,
  dm     NUMERIC(10,4) NOT NULL,
  as_of  DATE NOT NULL
);

-- ------------------------------------------------------ on_terms_overrides
CREATE TABLE IF NOT EXISTS on_terms_overrides (
  isin        TEXT NOT NULL,
  field       TEXT NOT NULL CHECK (field IN (
    'day_count', 'bdc', 'maturity_bdc', 'record_offset_days', 'payment_plaza',
    'min_denomination', 'min_trade_unit', 'increment', 'issued_amount', 'calls', 'puts'
  )),
  value       JSONB NOT NULL,
  source_url  TEXT NOT NULL,
  verified_at DATE,
  note        TEXT,
  PRIMARY KEY (isin, field)
);

COMMENT ON COLUMN on_terms_overrides.verified_at IS 'Set = verified against the primary source; NULL = secondary ("sin verificar")';

-- ------------------------------------------------------ on_corporate_events
CREATE TABLE IF NOT EXISTS on_corporate_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  isin        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('canje', 'rescate', 'default', 'reapertura')),
  event_date  DATE NOT NULL,
  note        TEXT,
  source_url  TEXT NOT NULL,
  verified_at DATE
);

-- --------------------------------------------------------------------- RLS
ALTER TABLE on_terms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "on_terms_read_all" ON on_terms;
CREATE POLICY "on_terms_read_all" ON on_terms FOR SELECT USING (true);
DROP POLICY IF EXISTS "on_terms_modify_service" ON on_terms;
CREATE POLICY "on_terms_modify_service" ON on_terms FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE on_cashflows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "on_cashflows_read_all" ON on_cashflows;
CREATE POLICY "on_cashflows_read_all" ON on_cashflows FOR SELECT USING (true);
DROP POLICY IF EXISTS "on_cashflows_modify_service" ON on_cashflows;
CREATE POLICY "on_cashflows_modify_service" ON on_cashflows FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE on_yield_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "on_yield_checks_read_all" ON on_yield_checks;
CREATE POLICY "on_yield_checks_read_all" ON on_yield_checks FOR SELECT USING (true);
DROP POLICY IF EXISTS "on_yield_checks_modify_service" ON on_yield_checks;
CREATE POLICY "on_yield_checks_modify_service" ON on_yield_checks FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE on_sov_curve ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "on_sov_curve_read_all" ON on_sov_curve;
CREATE POLICY "on_sov_curve_read_all" ON on_sov_curve FOR SELECT USING (true);
DROP POLICY IF EXISTS "on_sov_curve_modify_service" ON on_sov_curve;
CREATE POLICY "on_sov_curve_modify_service" ON on_sov_curve FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE on_terms_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "on_terms_overrides_read_all" ON on_terms_overrides;
CREATE POLICY "on_terms_overrides_read_all" ON on_terms_overrides FOR SELECT USING (true);
DROP POLICY IF EXISTS "on_terms_overrides_modify_service" ON on_terms_overrides;
CREATE POLICY "on_terms_overrides_modify_service" ON on_terms_overrides FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE on_corporate_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "on_corporate_events_read_all" ON on_corporate_events;
CREATE POLICY "on_corporate_events_read_all" ON on_corporate_events FOR SELECT USING (true);
DROP POLICY IF EXISTS "on_corporate_events_modify_service" ON on_corporate_events;
CREATE POLICY "on_corporate_events_modify_service" ON on_corporate_events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ------------------------------------------------------------------- RPC
-- One transaction: on_terms and on_cashflows are replaced whole (stale ISINs and
-- flows disappear), checks are upserted per day, the curve is replaced only when
-- p_sov is not NULL (last-good kept). JSON keys are the snake_case column names.
-- Callable only by service_role (the Warren worker).
CREATE OR REPLACE FUNCTION replace_on_terms(
  p_as_of  DATE,
  p_source TEXT,
  p_terms  JSONB,
  p_flows  JSONB,
  p_checks JSONB,
  p_sov    JSONB
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  DELETE FROM on_terms WHERE TRUE; -- cascades to on_cashflows

  INSERT INTO on_terms (
    isin, ticker_o, ticker_d, ticker_c, issuer, description, law, currency, payment_plaza,
    est, frequency, issue_date, maturity_date, coupon_rate, residual_pct, accrual_start,
    issued_amount_byma, adtv_o, adtv_d, adtv_c, as_of, source, updated_at
  )
  SELECT
    t.isin, t.ticker_o, t.ticker_d, t.ticker_c, t.issuer, t.description, t.law, t.currency, t.payment_plaza,
    t.est, t.frequency, t.issue_date, t.maturity_date, t.coupon_rate, t.residual_pct, t.accrual_start,
    t.issued_amount_byma, t.adtv_o, t.adtv_d, t.adtv_c, p_as_of, p_source, NOW()
  FROM jsonb_populate_recordset(NULL::on_terms, p_terms) t;

  INSERT INTO on_cashflows (isin, flow_date, ren, amo)
  SELECT f.isin, f.flow_date, f.ren, f.amo
  FROM jsonb_populate_recordset(NULL::on_cashflows, p_flows) f;

  INSERT INTO on_yield_checks (
    isin, as_of, byma_px, byma_ytm, method_ytm, method_diff_bp, terms_ytm, terms_diff_bp, flagged
  )
  SELECT c.isin, p_as_of, c.byma_px, c.byma_ytm, c.method_ytm, c.method_diff_bp, c.terms_ytm, c.terms_diff_bp, c.flagged
  FROM jsonb_populate_recordset(NULL::on_yield_checks, p_checks) c
  ON CONFLICT (isin, as_of) DO UPDATE SET
    byma_px = EXCLUDED.byma_px,
    byma_ytm = EXCLUDED.byma_ytm,
    method_ytm = EXCLUDED.method_ytm,
    method_diff_bp = EXCLUDED.method_diff_bp,
    terms_ytm = EXCLUDED.terms_ytm,
    terms_diff_bp = EXCLUDED.terms_diff_bp,
    flagged = EXCLUDED.flagged;

  IF p_sov IS NOT NULL THEN
    DELETE FROM on_sov_curve WHERE TRUE;
    INSERT INTO on_sov_curve (ticker, isin, law, px, ytm, dm, as_of)
    SELECT s.ticker, s.isin, s.law, s.px, s.ytm, s.dm, p_as_of
    FROM jsonb_populate_recordset(NULL::on_sov_curve, p_sov) s;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION replace_on_terms(DATE, TEXT, JSONB, JSONB, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION replace_on_terms(DATE, TEXT, JSONB, JSONB, JSONB, JSONB) TO service_role;

-- ------------------------------------------------------------------ seeds
-- Only terms VERIFIED against the issuer's own prospectus supplement / results
-- notice (public documents). Anything not verified here (MGCM, MGCR, TTCD, VSCX
-- and the rest of the catalog) stays on defaults and renders "sin verificar".
-- Corrections ship as new migrations.
--
-- CS50 = Cresud Clase L (AR0394353335)
--   https://bancoprovincia.com.ar/CDN/Get/CRESUD_Suplemento_Prospecto_Clase_L
-- DNCB = Edenor Clase 11 (AR0585477562)
--   https://edenor.com/files/investors/2026-07/EDENOR_SUPLEMENTO_ON_11.pdf
INSERT INTO on_terms_overrides (isin, field, value, source_url, verified_at, note) VALUES
  ('AR0394353335', 'day_count', '"ACT/365"'::jsonb, 'https://bancoprovincia.com.ar/CDN/Get/CRESUD_Suplemento_Prospecto_Clase_L', '2026-10-21', 'Cresud Clase L: ACT/365 (BYMA ren and ai assume cup/2 and 30/360)'),
  ('AR0394353335', 'payment_plaza', '"MEP"'::jsonb, 'https://bancoprovincia.com.ar/CDN/Get/CRESUD_Suplemento_Prospecto_Clase_L', '2026-10-21', 'USD paid in Argentina'),
  ('AR0394353335', 'min_trade_unit', '1'::jsonb, 'https://bancoprovincia.com.ar/CDN/Get/CRESUD_Suplemento_Prospecto_Clase_L', '2026-10-21', 'Minimum trading unit VN USD 1 (minimum subscription USD 100 is primary only)'),
  ('AR0394353335', 'calls', '[{"from": "2027-06-10", "to": null, "pricePct": 100}]'::jsonb, 'https://bancoprovincia.com.ar/CDN/Get/CRESUD_Suplemento_Prospecto_Clase_L', '2026-10-21', 'Issuer optional redemption from month 18 at 100% (tax call at 100% not modelled)'),
  ('AR0394353335', 'puts', '[{"kind": "change_of_control", "pricePct": 101, "note": "Holder put on change of control; multiples of USD 1,000"}]'::jsonb, 'https://bancoprovincia.com.ar/CDN/Get/CRESUD_Suplemento_Prospecto_Clase_L', '2026-10-21', 'Change-of-control put at 101%; informational, not a yield-to-worst candidate'),
  ('AR0585477562', 'day_count', '"ACT/365"'::jsonb, 'https://edenor.com/files/investors/2026-07/EDENOR_SUPLEMENTO_ON_11.pdf', '2026-10-21', 'Edenor Clase 11: ACT/365'),
  ('AR0585477562', 'payment_plaza', '"CCL"'::jsonb, 'https://edenor.com/files/investors/2026-07/EDENOR_SUPLEMENTO_ON_11.pdf', '2026-10-21', 'USD payable abroad (NY account of CVSA): dollar cable'),
  ('AR0585477562', 'min_trade_unit', '1'::jsonb, 'https://edenor.com/files/investors/2026-07/EDENOR_SUPLEMENTO_ON_11.pdf', '2026-10-21', 'Minimum VN USD 1 (minimum subscription USD 100 is primary only)'),
  ('AR0585477562', 'record_offset_days', '15'::jsonb, 'https://edenor.com/files/investors/2026-07/EDENOR_SUPLEMENTO_ON_11.pdf', '2026-10-21', 'Record date 15 calendar days before each payment date'),
  ('AR0585477562', 'issued_amount', '213462519'::jsonb, 'https://edenor.com/files/investors/2026-07/02._EDN_ON%20Clase_11_Aviso_de_Resultados_firma.pdf', '2026-10-21', 'Results notice: VN USD 213,462,519; BYMA mto shows 313,462,519 (data error)'),
  ('AR0585477562', 'calls', '[{"from": "2026-07-03", "to": "2027-07-03", "pricePct": 103.75}, {"from": "2027-07-03", "to": "2028-07-03", "pricePct": 101.875}, {"from": "2028-07-03", "to": null, "pricePct": 100}]'::jsonb, 'https://edenor.com/files/investors/2026-07/EDENOR_SUPLEMENTO_ON_11.pdf', '2026-10-21', 'Callable any time: 103.75% to 2027-07-03, 101.875% to 2028-07-03, 100% after (tax call not modelled)')
ON CONFLICT (isin, field) DO NOTHING;

-- ======================================================== ROLLBACK (manual)
-- Run only by hand; `ons`, `on_price_history` and `on_positions` are untouched.
-- DROP FUNCTION IF EXISTS replace_on_terms(DATE, TEXT, JSONB, JSONB, JSONB, JSONB);
-- DROP TABLE IF EXISTS on_corporate_events;
-- DROP TABLE IF EXISTS on_terms_overrides;
-- DROP TABLE IF EXISTS on_sov_curve;
-- DROP TABLE IF EXISTS on_yield_checks;
-- DROP TABLE IF EXISTS on_cashflows;
-- DROP TABLE IF EXISTS on_terms;
