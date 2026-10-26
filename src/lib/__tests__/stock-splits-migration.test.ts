// T2 (odd/tasks/split-aware-ledger.md S2): migration 053 adds stock_splits, split_factor and a
// split-aware sale re-check. Read as text: there is no database in the tests (the behavior was
// probed against Postgres 17, see the feature log).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const raw = readFileSync(join(process.cwd(), 'supabase/migrations/053_stock_splits.sql'), 'utf8')
const sql = raw.replace(/--.*$/gm, '').replace(/\s+/g, ' ')
const fn = (name: string) => sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'i'))?.[0] ?? ''

describe('053_stock_splits.sql', () => {
  it('stock_splits is a market table: one row per ticker and date, RLS on, no anon/authenticated access', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.stock_splits \(.*PRIMARY KEY \(ticker, date\)/i)
    expect(sql).toMatch(/ALTER TABLE public\.stock_splits ENABLE ROW LEVEL SECURITY/i)
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.stock_splits FROM PUBLIC, anon, authenticated/i)
  })

  it('split_factor counts splits after the date only, reads as definer with a fixed search_path, and anon cannot call it', () => {
    const body = fn('split_factor')
    expect(body).toMatch(/SECURITY DEFINER SET search_path = public, pg_temp/i)
    expect(body).toMatch(/date > p_after/)
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.split_factor\(TEXT, DATE\) FROM PUBLIC, anon/i)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.split_factor\(TEXT, DATE\) TO authenticated, service_role/i)
  })

  it('process_transaction_atomic keeps its signature and lock, and re-checks the total held through split_factor', () => {
    const body = fn('process_transaction_atomic')
    expect(body).toMatch(/p_date DATE, p_ticker TEXT DEFAULT NULL, p_operation TEXT DEFAULT NULL, p_quantity NUMERIC DEFAULT NULL, p_price NUMERIC DEFAULT NULL, p_commission NUMERIC DEFAULT 0, p_notes TEXT DEFAULT NULL, p_asset_type TEXT DEFAULT 'ACCION', p_moneda TEXT DEFAULT 'USD', p_user_id UUID DEFAULT NULL, p_trade_currency TEXT DEFAULT NULL, p_trade_quantity NUMERIC DEFAULT NULL, p_trade_price NUMERIC DEFAULT NULL, p_trade_commission NUMERIC DEFAULT NULL, p_cedear_ratio NUMERIC DEFAULT NULL, p_fx_mep NUMERIC DEFAULT NULL, p_fx_ccl NUMERIC DEFAULT NULL, p_fx_date DATE DEFAULT NULL, p_fx_source TEXT DEFAULT NULL/i)
    expect(body).toMatch(/SELECT SUM\(quantity \* public\.split_factor\(ticker, date\)\) FROM transactions/)
    expect(body).toMatch(/\/ public\.split_factor\(v_ticker, p_date\) - ABS\(p_quantity\) < -0\.0001/)
    expect(body.indexOf('pg_advisory_xact_lock')).toBeLessThan(body.indexOf('INSERT INTO transactions'))
  })

  it('changes no data', () => {
    const outside = sql.replace(/AS \$\$[\s\S]*?\$\$;/g, '')
    expect(outside).not.toMatch(/\b(UPDATE|DELETE FROM|INSERT INTO|DROP TABLE)\b/i)
  })
})
