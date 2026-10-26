// T6 (odd/tasks/split-aware-ledger.md S3): migration 054 converts the account's nine split-adjusted
// trades to as traded. Read as text: there is no database in the tests (the conversion was probed
// against Postgres 17, see the feature log).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const raw = readFileSync(join(process.cwd(), 'supabase/migrations/054_pre_split_trades_as_traded.sql'), 'utf8')
const sql = raw.replace(/--.*$/gm, '').replace(/\s+/g, ' ')
const ids = (part: string) => [...part.matchAll(/'([0-9a-f-]{36})'/g)].map(m => m[1]).sort()

describe('054_pre_split_trades_as_traded.sql', () => {
  const backup = sql.slice(sql.indexOf('CREATE TABLE backup.transactions_20261026'), sql.indexOf('DO $$'))
  const update = sql.slice(sql.indexOf('DO $$'))

  it('backs up exactly the rows it converts, of the one account, before converting them', () => {
    expect(sql.indexOf('CREATE TABLE backup.transactions_20261026')).toBeLessThan(sql.indexOf('UPDATE public.transactions'))
    expect(ids(backup).filter(id => !id.startsWith('54745d6e'))).toHaveLength(9)
    expect(ids(update).filter(id => !id.startsWith('54745d6e'))).toEqual(ids(backup).filter(id => !id.startsWith('54745d6e')))
    expect(update).toMatch(/t\.user_id = '54745d6e-3c1f-49b3-b46d-78d4016e8c20'/)
  })

  it('divides the quantity and multiplies the price by the split factor, only while the row holds its adjusted price', () => {
    expect(update).toMatch(/quantity = t\.quantity \/ f\.factor, price = t\.price \* f\.factor, trade_quantity = t\.trade_quantity \/ f\.factor, trade_price = t\.trade_price \* f\.factor/)
    expect(update).toMatch(/AND t\.price = f\.adjusted_price/)
  })

  it('aborts on a partial conversion, in one transaction; converting none is a notice', () => {
    expect(update).toMatch(/IF v_updated = 0 THEN RAISE NOTICE '[^']+'; ELSIF v_updated <> 9 THEN RAISE EXCEPTION/)
    expect(sql.trim().startsWith('BEGIN;')).toBe(true)
    expect(sql.trim().endsWith('COMMIT;')).toBe(true)
  })
})
