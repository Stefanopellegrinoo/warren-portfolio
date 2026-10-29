// odd/tasks/deposit-dates.md T3 (S3): the one write that splits a deposit into earlier dated
// deposits. Read as text: there is no database in the tests (scripts/test-redate-deposits-proof.sh
// runs it against a throwaway postgres).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const raw = readFileSync(join(process.cwd(), 'supabase/migrations/055_redate_deposits.sql'), 'utf8')
const sql = raw.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim()
const FN = 'public.redate_deposits(jsonb)'
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

describe('055_redate_deposits.sql', () => {
  it('runs in one transaction', () => {
    expect(sql).toMatch(/^BEGIN;/i)
    expect(sql).toMatch(/COMMIT;$/i)
  })

  it('runs as the signed-in user with a fixed search_path, and refuses without one', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.redate_deposits\(p_changes jsonb\) RETURNS integer/i)
    expect(sql).toMatch(/SECURITY INVOKER SET search_path = public, pg_temp/i)
    expect(sql).toMatch(/v_user uuid := auth\.uid\(\)/i)
    expect(sql).toMatch(/IF v_user IS NULL THEN RAISE EXCEPTION/i)
  })

  it('only touches the user\'s own external deposits, locked while it works', () => {
    expect(sql).toMatch(/WHERE id = \(v_change->>'id'\)::uuid AND user_id = v_user AND type = 'DEPOSITO' AND transaction_id IS NULL FOR UPDATE/i)
  })

  it('only while the deposit still has the amount the proposal saw: a second save of the same plan writes nothing', () => {
    expect(sql).toMatch(/IF v_change->'amount' IS NULL OR abs\(v_row\.amount - \(v_change->>'amount'\)::numeric\) > 0\.00005 THEN RAISE EXCEPTION 'redate_deposits: deposit % changed since the proposal'/i)
  })

  it('refuses parts that exceed the deposit, are not positive, or are not dated before it', () => {
    expect(sql).toMatch(/IF v_sum > v_row\.amount \+ 0\.005 THEN RAISE EXCEPTION/i)
    expect(sql).toMatch(/\(p->>'amount'\)::numeric <= 0 OR \(p->>'date'\)::date >= v_row\.date/i)
  })

  it('keeps the total: the parts are inserted and the deposit keeps the rest, or goes when nothing is left', () => {
    expect(sql).toMatch(/INSERT INTO public\.cash_movements \(user_id, type, amount, date, description, transaction_id\)/i)
    expect(sql).toMatch(/IF v_row\.amount - v_sum <= 0\.005 THEN DELETE FROM public\.cash_movements WHERE id = v_row\.id;/i)
    expect(sql).toMatch(/ELSE UPDATE public\.cash_movements SET amount = v_row\.amount - v_sum WHERE id = v_row\.id;/i)
  })

  it('no EXECUTE for PUBLIC or anon; signed-in users and the service role only', () => {
    expect(sql).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION ${esc(FN)} FROM PUBLIC, anon;`, 'i'))
    expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION ${esc(FN)} TO authenticated, service_role;`, 'i'))
  })
})
