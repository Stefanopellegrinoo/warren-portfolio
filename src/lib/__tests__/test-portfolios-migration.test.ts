import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const raw = readFileSync(join(process.cwd(), 'supabase/migrations/040_test_portfolios.sql'), 'utf8')
const [up, down = ''] = raw.split(/-- ={3,} ROLLBACK/i)
const strip = (s: string) => s.replace(/--.*$/gm, '').replace(/\s+/g, ' ')
const sql = strip(up)
const TABLES = ['test_portfolios', 'test_portfolio_items']

// Static guard; the real RLS proof (two users, anon) runs in a throwaway local Postgres.
describe('040_test_portfolios.sql', () => {
  it.each(TABLES)('%s: RLS on, no anon access, owner-only policies for the four commands', (t) => {
    expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${t} `, 'i'))
    expect(sql).toMatch(new RegExp(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`, 'i'))
    for (const cmd of ['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
      expect(sql).toMatch(new RegExp(`CREATE POLICY \\S+ ON ${t} FOR ${cmd} TO authenticated`, 'i'))
    expect(sql).toMatch(new RegExp(`REVOKE ALL ON ${t} FROM anon`, 'i'))
  })

  it('never uses a permissive predicate or grants to anon/public', () => {
    expect(sql).not.toMatch(/USING \(true\)|WITH CHECK \(true\)/i)
    expect(sql).not.toMatch(/TO (anon|public)\b/i)
    expect(sql).not.toMatch(/service_role/i)
  })

  it('ownership comes from auth.uid(); items go through the parent; UPDATE re-checks', () => {
    expect(sql).toMatch(/user_id = \(SELECT auth\.uid\(\)\)/i)
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM test_portfolios p WHERE p\.id = portfolio_id AND p\.user_id = \(SELECT auth\.uid\(\)\)\)/i)
    expect(sql).toMatch(/FOR UPDATE TO authenticated USING \([^;]*\) WITH CHECK \(/i)
  })

  it('user_id references auth.users; items cascade from the portfolio', () => {
    expect(sql).toMatch(/user_id UUID NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/i)
    expect(sql).toMatch(/portfolio_id UUID NOT NULL REFERENCES test_portfolios\(id\) ON DELETE CASCADE/i)
  })

  it('names are unique per user, case-insensitive, and length-bounded', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX (?:IF NOT EXISTS )?\S+ ON test_portfolios \(user_id, lower\(name\)\)/i)
    expect(sql).toMatch(/char_length\(btrim\(name\)\) BETWEEN 1 AND 60/i)
  })

  it('items: usd|vn mode, positive bounded amount, positive manual price, one row per ISIN, ISIN shape', () => {
    expect(sql).toMatch(/input_mode TEXT NOT NULL CHECK \(input_mode IN \('usd', 'vn'\)\)/i)
    expect(sql).toMatch(/amount NUMERIC\(\d+,\d+\) NOT NULL CHECK \(amount > 0 AND amount <= 1e12\)/i)
    expect(sql).toMatch(/manual_price NUMERIC\(\d+,\d+\) CHECK \(manual_price > 0\)/i)
    expect(sql).toMatch(/UNIQUE \(portfolio_id, isin\)/i)
    expect(sql).toMatch(/isin ~ '\^\[A-Z\]\{2\}\[A-Z0-9\]\{9\}\[0-9\]\$'/i)
  })

  it('limits are enforced in the database: 20 portfolios per user, 50 items per portfolio, serialized', () => {
    expect(sql).toMatch(/>= 20/)
    expect(sql).toMatch(/>= 50/)
    expect(sql).toMatch(/BEFORE INSERT ON test_portfolios/i)
    expect(sql).toMatch(/BEFORE INSERT ON test_portfolio_items/i)
    expect(sql.match(/pg_advisory_xact_lock/gi)?.length).toBe(2)
    expect(sql).toMatch(/test_portfolio_limit/)
    expect(sql).toMatch(/test_portfolio_item_limit/)
  })

  it('indexes the owner and the parent', () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS \S+ ON test_portfolios \(user_id\)/i)
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS \S+ ON test_portfolio_items \(portfolio_id\)/i)
  })

  it('has a commented rollback that drops both tables', () => {
    expect(down).toMatch(/DROP TABLE IF EXISTS test_portfolio_items/i)
    expect(down).toMatch(/DROP TABLE IF EXISTS test_portfolios/i)
    expect(down.split('\n').filter((l) => /DROP/.test(l)).every((l) => l.trim().startsWith('--'))).toBe(true)
  })

  it('carries no account data (no uuid literals, no emails)', () => {
    expect(raw).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    expect(raw).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i)
  })
})
