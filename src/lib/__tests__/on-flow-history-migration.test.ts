import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (f: string) => readFileSync(join(process.cwd(), 'supabase/migrations', f), 'utf8')
const raw = read('041_on_flow_history.sql')
const [up, down = ''] = raw.split(/-- ={3,} ROLLBACK/i)
const strip = (s: string) => s.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim()
const sql = strip(up)
const FN = /CREATE OR REPLACE FUNCTION replace_on_terms\([\s\S]*?END;\s*\$\$;/i
const fn039 = strip(read('039_on_terms.sql').match(FN)?.[0] ?? '')
const fn041Raw = up.match(FN)?.[0] ?? ''
const fn041 = strip(fn041Raw)
const historyBlock = fn041Raw.match(/-- BEGIN history upsert[\s\S]*?-- END history upsert\n?/)?.[0] ?? ''

describe('041_on_flow_history.sql', () => {
  it('creates the append-only table with the agreed columns and PK', () => {
    const t = sql.match(/CREATE TABLE IF NOT EXISTS on_flow_history \((.*?)\); /i)?.[1] ?? ''
    for (const c of ['isin TEXT NOT NULL', 'flow_date DATE NOT NULL', 'ren NUMERIC', 'amo NUMERIC', 'first_seen_as_of DATE NOT NULL', 'last_seen_as_of DATE NOT NULL', 'source TEXT NOT NULL'])
      expect(t).toContain(c)
    expect(t).toMatch(/PRIMARY KEY \(isin, flow_date\)/)
    expect(t).not.toMatch(/REFERENCES/i) // history must outlive the on_terms row
  })

  it('RLS: public read, service_role-only writes, table privileges revoked', () => {
    expect(sql).toMatch(/ALTER TABLE on_flow_history ENABLE ROW LEVEL SECURITY/i)
    expect(sql).toMatch(/ON on_flow_history FOR SELECT USING \(true\)/i)
    expect(sql).toMatch(/ON on_flow_history FOR ALL TO service_role USING \(true\) WITH CHECK \(true\)/i)
    expect(sql).toMatch(/REVOKE ALL ON on_flow_history FROM anon, authenticated; GRANT SELECT ON on_flow_history TO anon, authenticated/i)
    expect(sql).not.toMatch(/(FOR (ALL|INSERT|UPDATE|DELETE)|GRANT (?!SELECT ON)\w+(, \w+)* ON \w+) TO (anon|authenticated|public)/i)
  })

  it('never deletes from the history table', () => {
    expect(sql).not.toMatch(/DELETE FROM on_flow_history/i)
    expect(sql).not.toMatch(/TRUNCATE/i)
  })

  it('backfills once from on_cashflows with ON CONFLICT DO NOTHING', () => {
    expect(sql).toMatch(/INSERT INTO on_flow_history \(.*?\) SELECT .*? FROM on_cashflows c JOIN on_terms t .*? ON CONFLICT \(isin, flow_date\) DO NOTHING/i)
  })

  it('re-asserts REVOKE and GRANT on the function', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION replace_on_terms\(DATE, TEXT, JSONB, JSONB, JSONB, JSONB\) FROM PUBLIC, anon, authenticated/i)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION replace_on_terms\(DATE, TEXT, JSONB, JSONB, JSONB, JSONB\) TO service_role/i)
  })

  it('function body equals 039 except the history upsert block', () => {
    expect(fn039.length).toBeGreaterThan(500)
    expect(historyBlock).not.toBe('')
    const without = strip(fn041Raw.replace(historyBlock, ''))
    expect(without).toBe(fn039)
  })

  it('the history upsert sits after every guard and before the first DELETE', () => {
    const at = (re: RegExp) => fn041.search(re)
    const upsert = at(/INSERT INTO on_flow_history/i)
    expect(upsert).toBeGreaterThan(at(/p_checks IS NULL OR jsonb_typeof\(p_checks\) <> 'array'/i))
    expect(upsert).toBeLessThan(at(/DELETE FROM on_terms/i))
    expect(at(/RAISE EXCEPTION/i)).toBeLessThan(at(/DELETE FROM on_terms/i))
  })

  it('upserts new rows with first = last = p_as_of and only revises still-future flows', () => {
    const b = strip(historyBlock)
    expect(b).toMatch(/SELECT f\.isin, f\.flow_date, f\.ren, f\.amo, p_as_of, p_as_of, p_source/)
    expect(b).toMatch(/ON CONFLICT \(isin, flow_date\) DO UPDATE SET ren = EXCLUDED\.ren, amo = EXCLUDED\.amo, last_seen_as_of = EXCLUDED\.last_seen_as_of/)
    expect(b).toMatch(/WHERE on_flow_history\.flow_date > EXCLUDED\.last_seen_as_of AND on_flow_history\.last_seen_as_of <= EXCLUDED\.last_seen_as_of;/)
    expect(b).not.toMatch(/\bDELETE\b/i)
  })

  it('rollback restores the 039 body and drops only the history table', () => {
    const d = strip(down.replace(/^-- /gm, ''))
    expect(d).toMatch(/039_on_terms\.sql/)
    expect(d.match(FN)?.[0]).toBeDefined()
    expect(strip(d.match(FN)?.[0] ?? '')).toBe(fn039)
    expect(d).toMatch(/DROP TABLE IF EXISTS on_flow_history/i)
    expect(d).not.toMatch(/DROP TABLE IF EXISTS (on_terms|on_cashflows|ons|on_price_history|on_positions)\b/i)
  })
})
