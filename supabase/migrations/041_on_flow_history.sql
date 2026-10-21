-- Migration 041: append-only ON flow history.
--
-- Why: BYMA `ren`/`amo` list FUTURE flows only and replace_on_terms() replaces
-- on_terms (cascading to on_cashflows) every night, so a coupon or amortization
-- paid yesterday disappears from the DB tonight. Stage 6 (pending coupon and
-- amortization proposals for past dates) needs them. 039 is already applied in
-- prod and is NOT edited: this migration adds the history table and replaces the
-- function with a copy of 039's whose only difference is the history upsert
-- placed between the guards and the first DELETE.
--
-- Global, not per-user, no FK to on_terms (history must outlive the terms row of
-- a matured or delisted ON). RLS 037/039 shape: public read, service_role write.
-- Revision policy: see the comment inside the function.
--
-- Dates before history existed are NOT here: they are derived on read from
-- on_terms.accrual_start for fixed-rate, non-amortized bonds (src/lib/on-flow-history.ts).

CREATE TABLE IF NOT EXISTS on_flow_history (
  isin             TEXT NOT NULL,
  flow_date        DATE NOT NULL,
  ren              NUMERIC(14,6) NOT NULL DEFAULT 0,
  amo              NUMERIC(14,6) NOT NULL DEFAULT 0,
  first_seen_as_of DATE NOT NULL,
  last_seen_as_of  DATE NOT NULL,
  source           TEXT NOT NULL DEFAULT 'byma_educa',
  PRIMARY KEY (isin, flow_date)
);

COMMENT ON TABLE on_flow_history IS 'Append-only: every BYMA flow ever listed (unadjusted dates). Written only by replace_on_terms() and the 041 backfill; never deleted';

ALTER TABLE on_flow_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "on_flow_history_read_all" ON on_flow_history;
CREATE POLICY "on_flow_history_read_all" ON on_flow_history FOR SELECT USING (true);
DROP POLICY IF EXISTS "on_flow_history_modify_service" ON on_flow_history;
CREATE POLICY "on_flow_history_modify_service" ON on_flow_history FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON on_flow_history FROM anon, authenticated;
GRANT SELECT ON on_flow_history TO anon, authenticated;

-- One-time backfill from what the catalog holds today (first_seen = the catalog as_of).
INSERT INTO on_flow_history (isin, flow_date, ren, amo, first_seen_as_of, last_seen_as_of, source)
SELECT c.isin, c.flow_date, c.ren, c.amo, t.as_of, t.as_of, t.source
FROM on_cashflows c
JOIN on_terms t ON t.isin = c.isin
ON CONFLICT (isin, flow_date) DO NOTHING;

-- ------------------------------------------------------------------- RPC
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
  -- Guards BEFORE any DELETE: an empty or truncated payload must never wipe the
  -- catalog (the floor matches the adapter's MIN_VALID_ROWS).
  IF p_terms IS NULL OR jsonb_typeof(p_terms) <> 'array' OR jsonb_array_length(p_terms) < 200 THEN
    RAISE EXCEPTION 'replace_on_terms: p_terms must be an array of at least 200 rows';
  END IF;
  IF p_flows IS NULL OR jsonb_typeof(p_flows) <> 'array' THEN
    RAISE EXCEPTION 'replace_on_terms: p_flows must be an array';
  END IF;
  IF p_checks IS NULL OR jsonb_typeof(p_checks) <> 'array' THEN
    RAISE EXCEPTION 'replace_on_terms: p_checks must be an array';
  END IF;

  -- BEGIN history upsert (041): append-only, never deleted. BYMA lists FUTURE
  -- flows only, so this is the only place past flows survive the nightly replace.
  -- Policy: a flow whose date is still after p_as_of may be revised by BYMA, so
  -- its latest ren/amo wins and last_seen_as_of moves forward. Once
  -- flow_date <= p_as_of the row is frozen (a re-listing no longer changes it).
  -- as_of is monotonic: a replayed older payload never overwrites a newer row.
  -- A flow BYMA later removes (early redemption, canje, schedule fix) stays here
  -- with a stale last_seen_as_of; readers use that to flag it as unconfirmed.
  INSERT INTO on_flow_history (isin, flow_date, ren, amo, first_seen_as_of, last_seen_as_of, source)
  SELECT f.isin, f.flow_date, f.ren, f.amo, p_as_of, p_as_of, p_source
  FROM jsonb_populate_recordset(NULL::on_cashflows, p_flows) f
  ON CONFLICT (isin, flow_date) DO UPDATE SET
    ren = EXCLUDED.ren,
    amo = EXCLUDED.amo,
    last_seen_as_of = EXCLUDED.last_seen_as_of,
    source = EXCLUDED.source
  WHERE on_flow_history.flow_date > EXCLUDED.last_seen_as_of
    AND on_flow_history.last_seen_as_of <= EXCLUDED.last_seen_as_of;
  -- END history upsert

  DELETE FROM on_terms WHERE TRUE; -- cascades to on_cashflows

  INSERT INTO on_terms (
    isin, ticker_o, ticker_d, ticker_c, issuer, description, law, currency, payment_plaza,
    est, frequency, issue_date, maturity_date, coupon_rate, residual_pct, accrual_start,
    issued_amount_byma, adtv_o, adtv_d, adtv_c, as_of, source, updated_at
  )
  SELECT
    t.isin, t.ticker_o, t.ticker_d, t.ticker_c, t.issuer, t.description, t.law, t.currency, t.payment_plaza,
    t.est, t.frequency, t.issue_date, t.maturity_date, t.coupon_rate, COALESCE(t.residual_pct, 100), t.accrual_start,
    t.issued_amount_byma, t.adtv_o, t.adtv_d, t.adtv_c, p_as_of, p_source, NOW()
  FROM jsonb_populate_recordset(NULL::on_terms, p_terms) t;

  INSERT INTO on_cashflows (isin, flow_date, ren, amo)
  SELECT f.isin, f.flow_date, f.ren, f.amo
  FROM jsonb_populate_recordset(NULL::on_cashflows, p_flows) f;

  INSERT INTO on_yield_checks (
    isin, as_of, byma_px, byma_ytm, method_ytm, method_diff_bp, terms_ytm, terms_diff_bp, flagged, skip_reason
  )
  SELECT c.isin, p_as_of, c.byma_px, c.byma_ytm, c.method_ytm, c.method_diff_bp, c.terms_ytm, c.terms_diff_bp, c.flagged, c.skip_reason
  FROM jsonb_populate_recordset(NULL::on_yield_checks, p_checks) c
  ON CONFLICT (isin, as_of) DO UPDATE SET
    byma_px = EXCLUDED.byma_px,
    byma_ytm = EXCLUDED.byma_ytm,
    method_ytm = EXCLUDED.method_ytm,
    method_diff_bp = EXCLUDED.method_diff_bp,
    terms_ytm = EXCLUDED.terms_ytm,
    terms_diff_bp = EXCLUDED.terms_diff_bp,
    flagged = EXCLUDED.flagged,
    skip_reason = EXCLUDED.skip_reason;

  IF p_sov IS NOT NULL AND jsonb_typeof(p_sov) = 'array' AND jsonb_array_length(p_sov) >= 5 THEN
    DELETE FROM on_sov_curve WHERE TRUE;
    INSERT INTO on_sov_curve (ticker, isin, law, px, ytm, dm, as_of)
    SELECT s.ticker, s.isin, s.law, s.px, s.ytm, s.dm, p_as_of
    FROM jsonb_populate_recordset(NULL::on_sov_curve, p_sov) s;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION replace_on_terms(DATE, TEXT, JSONB, JSONB, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION replace_on_terms(DATE, TEXT, JSONB, JSONB, JSONB, JSONB) TO service_role;

-- ======================================================== ROLLBACK (manual)
-- Restores 039's function body (pasted verbatim from 039_on_terms.sql), then drops the history table (its data is lost).
-- CREATE OR REPLACE FUNCTION replace_on_terms(
--   p_as_of  DATE,
--   p_source TEXT,
--   p_terms  JSONB,
--   p_flows  JSONB,
--   p_checks JSONB,
--   p_sov    JSONB
-- ) RETURNS VOID
-- LANGUAGE plpgsql
-- SET search_path = public
-- AS $$
-- BEGIN
--   -- Guards BEFORE any DELETE: an empty or truncated payload must never wipe the
--   -- catalog (the floor matches the adapter's MIN_VALID_ROWS).
--   IF p_terms IS NULL OR jsonb_typeof(p_terms) <> 'array' OR jsonb_array_length(p_terms) < 200 THEN
--     RAISE EXCEPTION 'replace_on_terms: p_terms must be an array of at least 200 rows';
--   END IF;
--   IF p_flows IS NULL OR jsonb_typeof(p_flows) <> 'array' THEN
--     RAISE EXCEPTION 'replace_on_terms: p_flows must be an array';
--   END IF;
--   IF p_checks IS NULL OR jsonb_typeof(p_checks) <> 'array' THEN
--     RAISE EXCEPTION 'replace_on_terms: p_checks must be an array';
--   END IF;
--
--   DELETE FROM on_terms WHERE TRUE; -- cascades to on_cashflows
--
--   INSERT INTO on_terms (
--     isin, ticker_o, ticker_d, ticker_c, issuer, description, law, currency, payment_plaza,
--     est, frequency, issue_date, maturity_date, coupon_rate, residual_pct, accrual_start,
--     issued_amount_byma, adtv_o, adtv_d, adtv_c, as_of, source, updated_at
--   )
--   SELECT
--     t.isin, t.ticker_o, t.ticker_d, t.ticker_c, t.issuer, t.description, t.law, t.currency, t.payment_plaza,
--     t.est, t.frequency, t.issue_date, t.maturity_date, t.coupon_rate, COALESCE(t.residual_pct, 100), t.accrual_start,
--     t.issued_amount_byma, t.adtv_o, t.adtv_d, t.adtv_c, p_as_of, p_source, NOW()
--   FROM jsonb_populate_recordset(NULL::on_terms, p_terms) t;
--
--   INSERT INTO on_cashflows (isin, flow_date, ren, amo)
--   SELECT f.isin, f.flow_date, f.ren, f.amo
--   FROM jsonb_populate_recordset(NULL::on_cashflows, p_flows) f;
--
--   INSERT INTO on_yield_checks (
--     isin, as_of, byma_px, byma_ytm, method_ytm, method_diff_bp, terms_ytm, terms_diff_bp, flagged, skip_reason
--   )
--   SELECT c.isin, p_as_of, c.byma_px, c.byma_ytm, c.method_ytm, c.method_diff_bp, c.terms_ytm, c.terms_diff_bp, c.flagged, c.skip_reason
--   FROM jsonb_populate_recordset(NULL::on_yield_checks, p_checks) c
--   ON CONFLICT (isin, as_of) DO UPDATE SET
--     byma_px = EXCLUDED.byma_px,
--     byma_ytm = EXCLUDED.byma_ytm,
--     method_ytm = EXCLUDED.method_ytm,
--     method_diff_bp = EXCLUDED.method_diff_bp,
--     terms_ytm = EXCLUDED.terms_ytm,
--     terms_diff_bp = EXCLUDED.terms_diff_bp,
--     flagged = EXCLUDED.flagged,
--     skip_reason = EXCLUDED.skip_reason;
--
--   IF p_sov IS NOT NULL AND jsonb_typeof(p_sov) = 'array' AND jsonb_array_length(p_sov) >= 5 THEN
--     DELETE FROM on_sov_curve WHERE TRUE;
--     INSERT INTO on_sov_curve (ticker, isin, law, px, ytm, dm, as_of)
--     SELECT s.ticker, s.isin, s.law, s.px, s.ytm, s.dm, p_as_of
--     FROM jsonb_populate_recordset(NULL::on_sov_curve, p_sov) s;
--   END IF;
-- END;
-- $$;
-- REVOKE ALL ON FUNCTION replace_on_terms(DATE, TEXT, JSONB, JSONB, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION replace_on_terms(DATE, TEXT, JSONB, JSONB, JSONB, JSONB) TO service_role;
-- DROP TABLE IF EXISTS on_flow_history;
