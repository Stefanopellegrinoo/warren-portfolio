/**
 * The worker refreshes every summary each minute with new prices, but reads the ledgers, the ON
 * schedules and the trade-date FX only when something was written, and then only for the user who
 * wrote (odd/tasks/supabase-efficiency.md S2-S3, S7).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createServiceClient } from '@/lib/supabase-server'
import type { Quote } from '@/types'
import { cacheUserSummaries, forgetCycleInputs } from '../summary-cache'

const redis = { get: vi.fn(async () => null), eval: vi.fn(async () => 1) }
// The users who wrote since the last cycle; null: Redis cannot say.
let dirty: string[] | null = []
vi.mock('../redis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../redis')>()),
  getRedis: () => redis,
  readLedgerVersion: async () => '1',
  takeDirtyUsers: async () => {
    const taken = dirty
    if (taken !== null) dirty = []
    return taken
  },
}))
vi.mock('@/lib/supabase-server', () => ({ createServiceClient: vi.fn(), createServerClientInstance: vi.fn() }))
vi.mock('../currency', () => ({
  getDollarInfo: async (kind: string) => ({ rate: kind === 'mep' ? 1500 : 1600, asOf: '2026-10-27T15:00:00.000Z', source: 'live' }),
}))
vi.mock('../yahoo-finance', () => ({ fetchQuotes: vi.fn(async () => new Map()), cachePrice: vi.fn() }))
vi.mock('../stock-splits', () => ({ loadSplits: async () => new Map() }))

const reads: { table: string; user?: unknown }[] = []
const readsOf = (table: string) => reads.filter(r => r.table === table)
const failing = new Set<string>()
function db(tables: Record<string, Record<string, unknown>[]>) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {}
      const result = () => {
        reads.push({ table, user: filters.user_id })
        if (failing.has(table)) return { data: null, error: { message: `${table} down` } }
        return { data: (tables[table] ?? []).filter(r => Object.entries(filters).every(([k, v]) => r[k] === v)), error: null }
      }
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'order', 'gte', 'lte', 'limit', 'in', 'or']) q[m] = () => q
      q.eq = (col: string, val: unknown) => { filters[col] = val; return q }
      q.range = async () => result()
      q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko)
      return q
    },
  }
}

const trade = (user: string, quantity: number) => ({
  user_id: user, ticker: 'AAPL', operation: 'COMPRA', quantity, price: 320, commission: 0, date: '2026-05-04',
  asset_type: 'CEDEAR', created_at: '2026-05-04T12:00:00Z', trade_currency: 'ARS', trade_quantity: quantity * 20, trade_price: 22_400,
  trade_commission: 0, fx_mep: null, fx_ccl: null,
})
let tables: Record<string, Record<string, unknown>[]>
const quotes = new Map<string, Quote>([['AAPL', { ticker: 'AAPL', price: 330, change: 0, changePercent: 0, previousClose: 330 }]])
// The payload each user's summary got in the last cycle.
const payloads = () => new Map(redis.eval.mock.calls.map((c: unknown[]) => [String(c[2]).replace('summary:', ''), JSON.parse(c.at(-1) as string)]))

describe('cacheUserSummaries reuses what only a write changes', () => {
  beforeEach(() => {
    forgetCycleInputs()
    reads.length = 0
    failing.clear()
    dirty = []
    tables = {
      transactions: [trade('u1', 0.5), trade('u2', 2)],
      cash_movements: [{ user_id: 'u1', type: 'DEPOSITO', amount: 260, date: '2026-05-01' }, { user_id: 'u2', type: 'DEPOSITO', amount: 900, date: '2026-05-01' }],
      cedears: [{ ticker: 'AAPL', ratio: 20 }],
      fx_rates: [{ date: '2026-05-04', kind: 'ccl', buy: 1390, sell: 1410 }, { date: '2026-05-04', kind: 'mep', buy: 1380, sell: 1400 }],
    }
    vi.mocked(createServiceClient).mockReturnValue(db(tables) as never)
    redis.eval.mockClear()
  })
  afterEach(() => vi.useRealTimers())

  it('reads every ledger and trade-date FX once while nobody writes, and refreshes every summary each cycle', async () => {
    await cacheUserSummaries(quotes)
    const first = payloads()
    redis.eval.mockClear()
    await cacheUserSummaries(quotes)

    expect(readsOf('transactions')).toHaveLength(1)
    expect(readsOf('fx_rates')).toHaveLength(2) // one per user with a trade without FX
    // Reused inputs leave nothing behind: the same prices give the same summaries, views included.
    expect(first.get('u1').currencies).toBeDefined()
    expect(payloads()).toEqual(first)
  })

  it('a write re-reads only the user who wrote: the others are not read again and keep their summary', async () => {
    await cacheUserSummaries(quotes)
    const before = payloads()
    reads.length = 0
    redis.eval.mockClear()
    tables.transactions.push(trade('u2', 1))
    dirty = ['u2']

    await cacheUserSummaries(quotes)

    expect(readsOf('transactions')).toEqual([{ table: 'transactions', user: 'u2' }])
    expect(readsOf('cash_movements')).toEqual([{ table: 'cash_movements', user: 'u2' }])
    expect(readsOf('fx_rates')).toHaveLength(1)
    const after = payloads()
    expect(after.get('u1')).toEqual(before.get('u1'))
    expect(after.get('u2')).not.toEqual(before.get('u2'))
  })

  it('reads everyone every cycle when Redis cannot say who wrote, as before', async () => {
    dirty = null
    await cacheUserSummaries(quotes)
    await cacheUserSummaries(quotes)

    expect(readsOf('transactions')).toHaveLength(2)
    expect(readsOf('transactions').every(r => r.user === undefined)).toBe(true)
  })

  it('reads everyone again on a new day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-27T15:00:00Z'))
    await cacheUserSummaries(quotes)
    vi.setSystemTime(new Date('2026-10-28T03:01:00Z')) // 00:01 in Argentina

    await cacheUserSummaries(quotes)
    expect(readsOf('transactions')).toHaveLength(2)
  })

  it('a re-read that fails leaves the next cycle to read everyone, so no write is lost', async () => {
    await cacheUserSummaries(quotes)
    dirty = ['u2']
    failing.add('transactions')
    await expect(cacheUserSummaries(quotes)).rejects.toThrow()
    failing.clear()
    reads.length = 0

    await cacheUserSummaries(quotes)
    expect(readsOf('transactions')).toEqual([{ table: 'transactions', user: undefined }])
  })
})
