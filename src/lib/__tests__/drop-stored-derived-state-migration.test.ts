// T5.2 (odd/tasks/nucleo-ledger.md S5): migration 047 drops the stored derived state.
// Read as text: there is no database in the tests.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const raw = readFileSync(join(process.cwd(), 'supabase/migrations/047_drop_stored_derived_state.sql'), 'utf8')
const header = raw.slice(0, raw.search(/^\s*[^-\s]/m))
const sql = raw.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim()

const DROPPED = ['portfolio_snapshots', 'closed_trades', 'on_closed_trades', 'positions', 'on_positions', 'cash_balance']

describe('047_drop_stored_derived_state.sql', () => {
  it('drops exactly the six stored derived tables, IF EXISTS, without CASCADE', () => {
    const drops = [...sql.matchAll(/DROP TABLE IF EXISTS public\.(\w+);/gi)].map(m => m[1])
    expect(drops.sort()).toEqual([...DROPPED].sort())
    expect(sql).not.toMatch(/CASCADE/i)
  })

  it('drops nothing else: every statement is one of those drops, inside one transaction', () => {
    const statements = sql.split(';').map(s => s.trim()).filter(Boolean)
    expect(statements[0]).toMatch(/^BEGIN$/i)
    expect(statements.at(-1)).toMatch(/^COMMIT$/i)
    expect(statements.slice(1, -1)).toHaveLength(DROPPED.length)
    for (const s of statements.slice(1, -1)) expect(s).toMatch(/^DROP TABLE IF EXISTS public\.\w+$/i)
  })

  it('never names a ledger or market-data table', () => {
    for (const kept of ['transactions', 'cash_movements', 'on_payment_overrides', 'fx_rates', 'on_price_history', 'on_flow_history', 'on_terms', 'on_cashflows', 'ticker_identity']) {
      expect(sql).not.toMatch(new RegExp(`\\b${kept}\\b`, 'i'))
    }
  })

  it('says in its header when it may run: after the deploy, after 046, after the backup', () => {
    expect(header).toMatch(/AFTER .*deploy/i)
    expect(header).toMatch(/AFTER .*046/i)
    expect(header).toMatch(/backup/i)
  })
})
