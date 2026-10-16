import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/037_on_price_history.sql'), 'utf8')
  .replace(/--.*$/gm, '')
  .replace(/\s+/g, ' ')

// Static guard for S1.5; the real RLS check (anon INSERT rejected) runs post-apply.
describe('037_on_price_history.sql', () => {
  it('creates the table with PK (ticker, price_date) and close > 0', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS on_price_history/i)
    expect(sql).toMatch(/PRIMARY KEY \(ticker, price_date\)/i)
    expect(sql).toMatch(/close NUMERIC\(14,\s?4\) NOT NULL CHECK \(close > 0\)/i)
  })

  it('enables RLS, public select, service_role-only writes', () => {
    expect(sql).toMatch(/ALTER TABLE on_price_history ENABLE ROW LEVEL SECURITY/i)
    expect(sql).toMatch(/ON on_price_history FOR SELECT USING \(true\)/i)
    expect(sql).toMatch(/ON on_price_history FOR ALL TO service_role USING \(true\) WITH CHECK \(true\)/i)
  })
})
