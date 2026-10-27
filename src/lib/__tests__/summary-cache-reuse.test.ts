/**
 * The worker refreshes every summary each minute with new prices, but reads the ledgers, the ON
 * schedules and the trade-date FX only when something was written (odd/tasks/supabase-efficiency.md S2-S3).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createServiceClient } from '@/lib/supabase-server'
import type { Quote } from '@/types'
import { cacheUserSummaries } from '../summary-cache'

const redis = { get: vi.fn(async () => null), eval: vi.fn(async () => 1) }
let version: string | null = '1'
vi.mock('../redis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../redis')>()),
  getRedis: () => redis,
  readLedgerVersion: async () => version,
}))
vi.mock('@/lib/supabase-server', () => ({ createServiceClient: vi.fn(), createServerClientInstance: vi.fn() }))
vi.mock('../currency', () => ({
  getDollarInfo: async (kind: string) => ({ rate: kind === 'mep' ? 1500 : 1600, asOf: '2026-10-27T15:00:00.000Z', source: 'live' }),
}))
vi.mock('../yahoo-finance', () => ({ fetchQuotes: vi.fn(async () => new Map()), cachePrice: vi.fn() }))
vi.mock('../stock-splits', () => ({ loadSplits: async () => new Map() }))

const reads: Record<string, number> = {}
function db(tables: Record<string, Record<string, unknown>[]>) {
  return {
    from(table: string) {
      reads[table] = (reads[table] ?? 0) + 1
      const filters: Record<string, unknown> = {}
      const result = () => ({ data: (tables[table] ?? []).filter(r => Object.entries(filters).every(([k, v]) => r[k] === v)), error: null })
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'order', 'gte', 'lte', 'limit', 'in', 'or']) q[m] = () => q
      q.eq = (col: string, val: unknown) => { filters[col] = val; return q }
      q.range = async () => result()
      q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko)
      return q
    },
  }
}

const tables = {
  transactions: [{
    user_id: 'u1', ticker: 'AAPL', operation: 'COMPRA', quantity: 0.5, price: 320, commission: 0, date: '2026-05-04',
    asset_type: 'CEDEAR', created_at: '2026-05-04T12:00:00Z', trade_currency: 'ARS', trade_quantity: 10, trade_price: 22_400,
    trade_commission: 0, fx_mep: null, fx_ccl: null,
  }],
  cash_movements: [{ user_id: 'u1', type: 'DEPOSITO', amount: 260, date: '2026-05-01' }],
  cedears: [{ ticker: 'AAPL', ratio: 20 }],
  fx_rates: [{ date: '2026-05-04', kind: 'ccl', buy: 1390, sell: 1410 }, { date: '2026-05-04', kind: 'mep', buy: 1380, sell: 1400 }],
}
const quotes = new Map<string, Quote>([['AAPL', { ticker: 'AAPL', price: 330, change: 0, changePercent: 0, previousClose: 330 }]])

describe('cacheUserSummaries reuses what only a write changes', () => {
  beforeEach(() => {
    for (const k of Object.keys(reads)) delete reads[k]
    vi.mocked(createServiceClient).mockReturnValue(db(tables) as never)
    redis.eval.mockClear()
  })

  it('reads the ledgers and trade-date FX once while nothing is written, and refreshes every summary each cycle', async () => {
    version = '1'
    await cacheUserSummaries(quotes)
    await cacheUserSummaries(quotes)

    expect(reads.transactions).toBe(1)
    expect(reads.fx_rates).toBe(1)
    expect(redis.eval).toHaveBeenCalledTimes(2)
  })

  it('reads them again after a write moves the version', async () => {
    version = '7'
    await cacheUserSummaries(quotes)
    version = '8'
    await cacheUserSummaries(quotes)

    expect(reads.transactions).toBe(2)
    expect(redis.eval).toHaveBeenCalledTimes(2)
  })
})
