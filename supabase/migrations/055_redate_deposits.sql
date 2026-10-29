-- Migration 055: split a deposit into earlier dated deposits (odd/tasks/deposit-dates.md T3, S3).
--
-- WHY
-- Trade cash legs are dated on the trade day, but a user may record the money that paid for
-- those trades later, in a few lump deposits: the cash then reads negative for years. The app
-- proposes, for any user, which earlier days each lump paid (GET /api/cash/deposit-dates);
-- once the user confirms, this function saves it: each part becomes a DEPOSITO on its day and
-- the lump keeps the rest. The total deposited does not change.
--
-- WHAT
-- public.redate_deposits(p_changes jsonb) RETURNS integer — p_changes is
--   [{ "id": "<deposit uuid>", "amount": <the deposit's amount when proposed>,
--      "parts": [{ "date": "YYYY-MM-DD", "amount": 123.4567 }, ...] }, ...]
-- and the result is the number of deposits inserted. One call is one transaction: any refused
-- change refuses them all and nothing is written.
--
-- SAFETY
-- SECURITY INVOKER: it runs as the signed-in user, so the own_cash_movements policy (003) still
-- decides, and it also filters on auth.uid() itself. Only the user's own external deposits
-- (type DEPOSITO, no transaction behind them) can be split, locked FOR UPDATE while the call
-- works, and only while it still has the amount the proposal saw: a second save of the same plan
-- (a double click) finds it changed and writes nothing. A part must be positive and dated before
-- its deposit; the parts may not exceed the
-- deposit by more than half a cent (rounding to the column's 4 decimals). The route checks the
-- plan against a fresh proposal before calling (only dates may differ) and that no date is after
-- today. No EXECUTE for PUBLIC or anon.
-- Rollback: DROP FUNCTION public.redate_deposits(jsonb); — a split already saved is undone by
-- adding its parts back to the deposit they came from (each part says which in its description).

BEGIN;

CREATE OR REPLACE FUNCTION public.redate_deposits(p_changes jsonb) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_change jsonb;
  v_parts jsonb;
  v_row public.cash_movements%ROWTYPE;
  v_sum numeric;
  v_inserted integer := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'redate_deposits: no signed-in user'; END IF;
  IF jsonb_typeof(p_changes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_changes) = 0 THEN
    RAISE EXCEPTION 'redate_deposits: no changes';
  END IF;

  FOR v_change IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
    SELECT * INTO v_row FROM public.cash_movements
      WHERE id = (v_change->>'id')::uuid AND user_id = v_user AND type = 'DEPOSITO' AND transaction_id IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'redate_deposits: deposit % not found', v_change->>'id'; END IF;
    IF v_change->'amount' IS NULL OR abs(v_row.amount - (v_change->>'amount')::numeric) > 0.00005 THEN
      RAISE EXCEPTION 'redate_deposits: deposit % changed since the proposal', v_row.id;
    END IF;

    v_parts := v_change->'parts';
    IF jsonb_typeof(v_parts) IS DISTINCT FROM 'array' OR jsonb_array_length(v_parts) = 0 THEN
      RAISE EXCEPTION 'redate_deposits: deposit % has no parts', v_row.id;
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_parts) p
      WHERE (p->>'amount')::numeric <= 0 OR (p->>'date')::date >= v_row.date
    ) THEN
      RAISE EXCEPTION 'redate_deposits: a part of deposit % is not positive or not dated before it', v_row.id;
    END IF;
    SELECT sum((p->>'amount')::numeric) INTO v_sum FROM jsonb_array_elements(v_parts) p;
    IF v_sum > v_row.amount + 0.005 THEN RAISE EXCEPTION 'redate_deposits: the parts exceed deposit %', v_row.id; END IF;

    INSERT INTO public.cash_movements (user_id, type, amount, date, description, transaction_id)
      SELECT v_user, 'DEPOSITO', (p->>'amount')::numeric, (p->>'date')::date,
             'Parte del depósito del ' || to_char(v_row.date, 'DD/MM/YYYY'), NULL
      FROM jsonb_array_elements(v_parts) p;
    v_inserted := v_inserted + jsonb_array_length(v_parts);

    IF v_row.amount - v_sum <= 0.005 THEN DELETE FROM public.cash_movements WHERE id = v_row.id;
    ELSE UPDATE public.cash_movements SET amount = v_row.amount - v_sum WHERE id = v_row.id;
    END IF;
  END LOOP;

  RETURN v_inserted;
END $$;

-- As in 048 and 051: no EXECUTE from PUBLIC or anon, only signed-in users (and the service role).
REVOKE EXECUTE ON FUNCTION public.redate_deposits(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redate_deposits(jsonb) TO authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'redate_deposits' AND NOT prosecdef) THEN
    RAISE EXCEPTION '055: redate_deposits missing or not SECURITY INVOKER';
  END IF;
END $$;

COMMIT;
