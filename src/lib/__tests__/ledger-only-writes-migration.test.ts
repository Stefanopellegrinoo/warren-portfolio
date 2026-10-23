// T5.1 (odd/tasks/nucleo-ledger.md S5): migration 046 reduces the three write RPCs to
// "validate inputs, insert ledger rows". Read as text: there is no database in the tests.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const raw = readFileSync(join(process.cwd(), 'supabase/migrations/046_ledger_only_writes.sql'), 'utf8')
const sql = raw.replace(/--.*$/gm, '').replace(/\s+/g, ' ')
const fn = (name: string) => sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'i'))?.[0] ?? ''
const STORED = ['positions', 'on_positions', 'closed_trades', 'on_closed_trades', 'cash_balance']

describe('046_ledger_only_writes.sql', () => {
  for (const name of ['process_transaction_atomic', 'import_transactions_atomic', 'replace_portfolio_atomic']) {
    it(`${name} touches no stored derived table and accepts no CUPON`, () => {
      const body = fn(name)
      expect(body).not.toBe('')
      for (const t of STORED) expect(body).not.toMatch(new RegExp(`\\b(FROM|INTO|UPDATE|JOIN) (public\\.)?${t}\\b`, 'i'))
      expect(body).not.toMatch(/CUPON/)
      expect(body).toMatch(/INSERT INTO (public\.)?transactions/i)
      expect(body).toMatch(/INSERT INTO (public\.)?cash_movements/i)
    })
  }

  it('process_transaction_atomic keeps the 044 signature (one overload, same callers)', () => {
    expect(fn('process_transaction_atomic')).toMatch(/p_date DATE, p_ticker TEXT DEFAULT NULL, p_operation TEXT DEFAULT NULL, p_quantity NUMERIC DEFAULT NULL, p_price NUMERIC DEFAULT NULL, p_commission NUMERIC DEFAULT 0, p_notes TEXT DEFAULT NULL, p_asset_type TEXT DEFAULT 'ACCION', p_moneda TEXT DEFAULT 'USD', p_user_id UUID DEFAULT NULL, p_trade_currency TEXT DEFAULT NULL, p_trade_quantity NUMERIC DEFAULT NULL, p_trade_price NUMERIC DEFAULT NULL, p_trade_commission NUMERIC DEFAULT NULL, p_cedear_ratio NUMERIC DEFAULT NULL, p_fx_mep NUMERIC DEFAULT NULL, p_fx_ccl NUMERIC DEFAULT NULL, p_fx_date DATE DEFAULT NULL, p_fx_source TEXT DEFAULT NULL/i)
  })

  it('serializes sales of one ticker per user and re-checks the total held from the ledger', () => {
    const body = fn('process_transaction_atomic')
    expect(body).toMatch(/pg_advisory_xact_lock\(hashtext\(v_user_id::text \|\| ':' \|\| v_ticker\)\)/)
    expect(body).toMatch(/SELECT SUM\(quantity\) FROM transactions WHERE user_id = v_user_id AND UPPER\(TRIM\(ticker\)\) = v_ticker/)
    expect(body.indexOf('pg_advisory_xact_lock')).toBeLessThan(body.indexOf('INSERT INTO transactions'))
  })

  it('a DIVIDENDO without quantity (the cash form) is a cash-only movement of p_price', () => {
    expect(fn('process_transaction_atomic')).toMatch(/v_operation = 'DIVIDENDO' AND p_quantity IS NULL/i)
  })

  it('replace no longer resets cash_balance and still keeps manual cash movements', () => {
    expect(fn('replace_portfolio_atomic')).toMatch(/DELETE FROM cash_movements WHERE user_id = p_user_id AND transaction_id IS NOT NULL/i)
  })

  it('is not wrapped in a rollback section and leaves the stored tables in place (T5.2 drops them)', () => {
    expect(sql).not.toMatch(/DROP TABLE/i)
  })
})
