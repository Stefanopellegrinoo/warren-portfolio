// T12 (odd/tasks/security-hardening.md S12): migration 049 leaves the market and
// reference tables readable only by the service role. Read as text: no database in tests.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const raw = readFileSync(join(process.cwd(), 'supabase/migrations/049_market_tables_server_only.sql'), 'utf8')
const sql = raw.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim()

// table → its permissive read policy (live names, checked 2026-10-23)
const READ_POLICIES: Record<string, string> = {
  activos: '"Allow read activos"',
  cedears: '"Allow read cedears"',
  fx_rates: 'fx_rates_read',
  on_cashflows: 'on_cashflows_read_all',
  on_corporate_events: 'on_corporate_events_read_all',
  on_flow_history: 'on_flow_history_read_all',
  on_price_history: 'on_price_history_read_all',
  on_sov_curve: 'on_sov_curve_read_all',
  on_terms: 'on_terms_read_all',
  on_terms_overrides: 'on_terms_overrides_read_all',
  on_yield_checks: 'on_yield_checks_read_all',
  ons: 'ons_read_all',
  ticker_identity: 'ticker_identity_read',
}
const TABLES = Object.keys(READ_POLICIES)
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

describe('049_market_tables_server_only.sql', () => {
  it('runs in one transaction', () => {
    expect(sql).toMatch(/^BEGIN;/i)
    expect(sql).toMatch(/COMMIT;$/i)
  })

  it.each(TABLES)('%s: drops its open read policy', (t) => {
    expect(sql).toMatch(new RegExp(`DROP POLICY IF EXISTS ${esc(READ_POLICIES[t])} ON public\\.${t};`, 'i'))
  })

  it('revokes every privilege on the 13 tables from anon and authenticated', () => {
    const revoke = sql.match(/REVOKE ALL ON TABLE (.+?) FROM anon, authenticated;/i)
    expect(revoke).not.toBeNull()
    expect(revoke![1].split(',').map(s => s.trim().replace(/^public\./, '')).sort()).toEqual([...TABLES].sort())
  })

  it('touches nothing else: no user table, no service-role policy, no data', () => {
    const statements = sql.split(';').map(s => s.trim()).filter(Boolean).slice(1, -1)
    expect(statements).toHaveLength(TABLES.length + 1)
    for (const s of statements) expect(s).toMatch(/^(DROP POLICY IF EXISTS|REVOKE ALL ON TABLE)/i)
    for (const user of ['transactions', 'cash_movements', 'on_payment_overrides', 'watchlists', 'alerts']) {
      expect(sql).not.toMatch(new RegExp(`\\b${user}\\b`, 'i'))
    }
    expect(sql).not.toMatch(/service/i)
  })
})
