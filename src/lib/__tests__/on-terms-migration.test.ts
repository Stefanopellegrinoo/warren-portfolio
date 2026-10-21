import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const raw = readFileSync(join(process.cwd(), 'supabase/migrations/039_on_terms.sql'), 'utf8')
const [up, down = ''] = raw.split(/-- ={3,} ROLLBACK/i)
const strip = (s: string) => s.replace(/--.*$/gm, '').replace(/\s+/g, ' ')
const sql = strip(up)
const TABLES = ['on_terms', 'on_cashflows', 'on_yield_checks', 'on_sov_curve', 'on_terms_overrides', 'on_corporate_events']
// The 6 held ONs are public ISINs (BYMA Educa). Only CS50 and DNCB have a primary source URL.
const SEEDED_ISINS = ['AR0394353335', 'AR0585477562']

// Static guard; the real RLS check (anon INSERT rejected) runs after apply.
describe('039_on_terms.sql', () => {
  it.each(TABLES)('%s: RLS on, public read, service_role-only writes (037 shape)', (t) => {
    expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${t} `, 'i'))
    expect(sql).toMatch(new RegExp(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`, 'i'))
    expect(sql).toMatch(new RegExp(`ON ${t} FOR SELECT USING \\(true\\)`, 'i'))
    expect(sql).toMatch(new RegExp(`ON ${t} FOR ALL TO service_role USING \\(true\\) WITH CHECK \\(true\\)`, 'i'))
  })

  it('never grants a write policy to anon or authenticated', () => {
    expect(sql).not.toMatch(/TO (anon|authenticated|public)/i)
    expect(sql).not.toMatch(/FOR (INSERT|UPDATE|DELETE)/i)
  })

  it('on_terms has fc, residual, accrual start, plaza, law; no min_lot, no day count', () => {
    const t = sql.match(/CREATE TABLE IF NOT EXISTS on_terms \((.*?)\); /i)?.[1] ?? ''
    for (const c of ['frequency', 'residual_pct', 'accrual_start', 'payment_plaza', 'law', 'issued_amount_byma', 'adtv_o', 'est'])
      expect(t).toContain(c)
    expect(t).not.toMatch(/min_lot|day_count/i)
  })

  it('overrides: EAV with NOT NULL source_url, verified_at and enumerated fields', () => {
    expect(sql).toMatch(/source_url TEXT NOT NULL/i)
    expect(sql).toMatch(/verified_at DATE,/i)
    expect(sql).toMatch(/PRIMARY KEY \(isin, field\)/i)
    for (const f of ['day_count', 'bdc', 'maturity_bdc', 'record_offset_days', 'payment_plaza', 'min_denomination', 'min_trade_unit', 'increment', 'issued_amount', 'calls', 'puts'])
      expect(sql).toContain(`'${f}'`)
  })

  it('corporate events kind is CHECK-enumerated', () => {
    expect(sql).toMatch(/kind TEXT NOT NULL CHECK \(kind IN \('canje', 'rescate', 'default', 'reapertura'\)\)/i)
  })

  it('yield checks carry method and terms diffs', () => {
    for (const c of ['method_ytm', 'method_diff_bp', 'terms_ytm', 'terms_diff_bp', 'skip_reason']) expect(sql).toContain(c)
    expect(sql).toMatch(/c\.flagged, c\.skip_reason/)
  })

  it('seeds only public ISINs and every seed row has a source URL', () => {
    const rows = [...sql.matchAll(/\('(AR[0-9A-Z]{10})', '(\w+)', '(.*?)'(?:::jsonb)?, '(https:\/\/[^']+)', (NULL|'\d{4}-\d{2}-\d{2}')/g)]
    expect(rows.length).toBeGreaterThanOrEqual(8)
    for (const r of rows) expect(SEEDED_ISINS).toContain(r[1])
    const isinsInInserts = [...sql.matchAll(/'(AR[0-9A-Z]{10})'/g)].map((m) => m[1])
    for (const i of isinsInInserts) expect(SEEDED_ISINS).toContain(i)
  })

  it('seeds the verified facts: ACT/365, DNCB call schedule, record offset, CS50 put', () => {
    expect(sql).toContain('"ACT/365"')
    expect(sql).toContain('"pricePct": 103.75')
    expect(sql).toContain('"pricePct": 101.875')
    expect(sql).toContain('"to": "2027-07-03"')
    expect(sql).toMatch(/'record_offset_days', '15'/)
    expect(sql).toContain('"kind": "change_of_control"')
    expect(sql).toContain('"pricePct": 101')
  })

  it('no secrets, accounts or lots of unverified ONs', () => {
    expect(sql).not.toMatch(/user_id|portfolio_id|service_role_key|min_lot/i)
    for (const t of ['MGCM', 'MGCR', 'TTCD', 'VSCX']) expect(sql).not.toContain(t)
  })

  it('has an RPC callable only by service_role', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION replace_on_terms/i)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION replace_on_terms\(.*?\) FROM PUBLIC, anon, authenticated/i)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION replace_on_terms\(.*?\) TO service_role/i)
  })

  it('rollback drops the RPC and all 6 tables and nothing else', () => {
    const d = strip(down.replace(/^-- (?=DROP)/gm, ''))
    expect(d).toMatch(/DROP FUNCTION IF EXISTS replace_on_terms/i)
    for (const t of TABLES) expect(d).toMatch(new RegExp(`DROP TABLE IF EXISTS ${t}\\b`, 'i'))
    expect(d).not.toMatch(/DROP TABLE IF EXISTS (ons|on_price_history|on_positions)\b/i)
  })

  it('replace_on_terms refuses to wipe the catalog: guards on every payload', () => {
    const fn = sql.match(/CREATE OR REPLACE FUNCTION replace_on_terms.*?\$\$ LANGUAGE|CREATE OR REPLACE FUNCTION replace_on_terms.*?END; \$\$/i)?.[0] ?? ''
    expect(fn).toMatch(/p_terms IS NULL OR jsonb_typeof\(p_terms\) <> 'array' OR jsonb_array_length\(p_terms\) < 200/i)
    expect(fn).toMatch(/p_flows IS NULL OR jsonb_typeof\(p_flows\) <> 'array'/i)
    expect(fn).toMatch(/p_checks IS NULL OR jsonb_typeof\(p_checks\) <> 'array'/i)
    expect(fn).toMatch(/RAISE EXCEPTION/i)
    // guards come before the first DELETE
    expect(fn.search(/RAISE EXCEPTION/i)).toBeLessThan(fn.search(/DELETE FROM on_terms/i))
  })

  it('replaces the curve only with an array of at least 5 rows', () => {
    expect(sql).toMatch(/IF p_sov IS NOT NULL AND jsonb_typeof\(p_sov\) = 'array' AND jsonb_array_length\(p_sov\) >= 5 THEN/i)
  })

  it('revokes table write privileges from anon and authenticated (defence in depth)', () => {
    for (const t of TABLES)
      expect(sql).toMatch(new RegExp(`REVOKE INSERT, UPDATE, DELETE ON ${t} FROM anon, authenticated`, 'i'))
  })

  it('uses the www bancoprovincia URL (the bare host is dead)', () => {
    expect(sql).toContain('https://www.bancoprovincia.com.ar/CDN/Get/')
    expect(sql).not.toContain('https://bancoprovincia.com.ar')
  })
})
