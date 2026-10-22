/**
 * The worker's summary carries the Pesos / MEP / Cable views next to the
 * existing fields, which every other consumer of /api/positions reads unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createServiceClient } from '@/lib/supabase-server'
import type { Quote } from '@/types'
import { cacheUserSummaries } from '../summary-cache'
import { valuePortfolio } from '../portfolio-valuation'

const mockRedis = {
  get: vi.fn().mockResolvedValue(null),
  eval: vi.fn().mockResolvedValue(1),
  setex: vi.fn().mockResolvedValue('OK'),
  connect: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
}
vi.mock('ioredis', () => ({ default: class { constructor() { Object.assign(this, mockRedis) } } }))
vi.mock('@/lib/supabase-server', () => ({ createServiceClient: vi.fn(), createServerClientInstance: vi.fn() }))
// Today's dollar is live (odd/tasks/nucleo-ledger.md T1.2); fx_rates only serves trade dates.
const liveDollar = vi.fn(async (kind: string): Promise<unknown> =>
  ({ rate: kind === 'mep' ? 1500 : 1600, asOf: '2026-10-21T20:00:00.000Z', source: 'live' }))
vi.mock('../currency', () => ({ getDollarInfo: (kind: string) => liveDollar(kind) }))

const local = new Map<string, Quote>([['local:AAPL', { ticker: 'AAPL', price: 28_420, change: 0, changePercent: 0.0121, previousClose: 28_420 }]])
vi.mock('../yahoo-finance', () => ({
  fetchQuotes: vi.fn(async (keys: string[]) => new Map(keys.filter(k => local.has(k)).map(k => [k, local.get(k)!]))),
  cachePrice: vi.fn(),
}))

/** Chainable PostgREST stand-in: eq filters apply, everything else passes through. */
function db(tables: Record<string, Record<string, unknown>[]>, failing: string[] = []) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {}
      const result = () => {
        if (failing.includes(table)) return { data: null, error: { message: `${table} down` } }
        return { data: (tables[table] ?? []).filter(r => Object.entries(filters).every(([k, v]) => r[k] === v)), error: null }
      }
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'order', 'gte', 'lte', 'limit']) q[m] = () => q
      q.eq = (col: string, val: unknown) => { filters[col] = val; return q }
      q.range = async () => result()
      q.maybeSingle = async () => { const r = result(); return { data: r.data?.[0] ?? null, error: r.error } }
      q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko)
      return q
    },
  }
}

const positions = [{ user_id: 'u1', ticker: 'AAPL', quantity: 0.5, avg_cost: 320, total_invested: 160 }]
const tables = {
  positions,
  cash_balance: [{ user_id: 'u1', balance: 100 }],
  cedears: [{ ticker: 'AAPL', ratio: 20 }],
  fx_rates: [
    { date: '2026-10-21', kind: 'mep', buy: 1490, sell: 1510 },
    { date: '2026-10-21', kind: 'ccl', buy: 1590, sell: 1610 },
  ],
  transactions: [{
    user_id: 'u1', ticker: 'AAPL', date: '2026-05-04', created_at: '2026-05-04T12:00:00Z', operation: 'COMPRA', asset_type: 'CEDEAR',
    quantity: 0.5, price: 320, commission: 0, trade_currency: 'ARS', trade_quantity: 10, trade_price: 20_000, trade_commission: 0,
    fx_mep: 1000, fx_ccl: 1250,
  }],
}
const stockQuotes = new Map<string, Quote>([['AAPL', { ticker: 'AAPL', price: 260, change: 2, changePercent: 0.0078, previousClose: 258 }]])

function writtenPayload() {
  const call = mockRedis.eval.mock.calls.find(c => c[2] === 'summary:u1')
  expect(call).toBeDefined()
  return JSON.parse(call![6])
}

// What the summary held before the views existed, for the same inputs.
const before = JSON.parse(JSON.stringify(valuePortfolio(
  { positions: positions as never, onPositions: [], cashBalance: 100, realized: 0, onRealized: 0 },
  { stockQuotes, onQuotes: new Map() },
  { missingQuotePolicy: 'drop' },
)))

beforeEach(() => {
  vi.clearAllMocks()
  mockRedis.get.mockResolvedValue(null)
  mockRedis.eval.mockResolvedValue(1)
})

describe('cacheUserSummaries with the currency views', () => {
  it('adds a versioned `currencies` field and leaves every existing field as it was', async () => {
    vi.mocked(createServiceClient).mockReturnValue(db(tables) as never)

    await cacheUserSummaries(stockQuotes, new Map())

    const payload = writtenPayload()
    expect(Object.keys(payload)).toEqual(['positions', 'onPositions', 'summary', 'unpricedCount', 'unpricedTickers', 'currencies'])
    expect(payload.positions).toEqual(before.positions)
    expect(payload.onPositions).toEqual(before.onPositions)
    expect(payload.summary).toEqual(before.summary)
    expect(payload.unpricedCount).toBe(before.unpricedCount)
    expect(payload.unpricedTickers).toEqual(before.unpricedTickers)

    const v = payload.currencies
    expect(v.version).toBe(1)
    expect(v.fx).toEqual({ mep: 1500, ccl: 1600, mepDate: '2026-10-21', cclDate: '2026-10-21' })
    expect(v.positions.AAPL.value).toEqual({ ARS: 284_200, MEP: 284_200 / 1500, CCL: 177.625 })
    expect(v.positions.AAPL.cost).toEqual({ ARS: 200_000, MEP: 200, CCL: 160 })
    expect(v.positions.AAPL.source).toBe('local')
    expect(v.totals.cash).toEqual({ ARS: 150_000, MEP: 100, CCL: 150_000 / 1600 })
    expect(v.totals.value.ARS).toBe(434_200)
    expect(v.estimated).toBe(false)
  })

  it('a failure loading the views still writes the summary, without `currencies`', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(createServiceClient).mockReturnValue(db(tables, ['transactions']) as never)

    await cacheUserSummaries(stockQuotes, new Map())

    const payload = writtenPayload()
    expect(Object.keys(payload)).toEqual(['positions', 'onPositions', 'summary', 'unpricedCount', 'unpricedTickers'])
    expect(payload.summary).toEqual(before.summary)
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('currency views'), expect.anything())
    errSpy.mockRestore()
  })

  it('a row loaded without FX uses the reference FX of its trade date', async () => {
    vi.mocked(createServiceClient).mockReturnValue(db({
      ...tables,
      positions: [{ user_id: 'u1', ticker: 'KO', quantity: 1, avg_cost: 60, total_invested: 60 }],
      fx_rates: [...tables.fx_rates, { date: '2026-05-01', kind: 'mep', buy: 1000, sell: 1000 }, { date: '2026-05-01', kind: 'ccl', buy: 1250, sell: 1250 }],
      transactions: [{
        user_id: 'u1', ticker: 'KO', date: '2026-05-04', created_at: '2026-05-04T12:00:00Z', operation: 'COMPRA', asset_type: 'ACCION',
        quantity: '1', price: '60', commission: '0', trade_currency: null, trade_quantity: null, trade_price: null, trade_commission: null,
        fx_mep: null, fx_ccl: null,
      }],
    }) as never)

    await cacheUserSummaries(new Map([['KO', { ticker: 'KO', price: 70, change: 0, changePercent: 0, previousClose: 70 }]]), new Map())

    const ko = writtenPayload().currencies.positions.KO
    expect(ko.cost).toEqual({ ARS: 75_000, MEP: 75, CCL: 60 })
    expect(ko.costEstimated).toBe(false)
    expect(ko.value).toEqual({ ARS: 112_000, MEP: 112_000 / 1500, CCL: 70 })
    expect(ko.source).toBe('estimated')
  })

  it('no dollar for today: no views, the summary is unchanged', async () => {
    vi.mocked(createServiceClient).mockReturnValue(db(tables) as never)
    liveDollar.mockResolvedValueOnce(null).mockResolvedValueOnce(null)

    await cacheUserSummaries(stockQuotes, new Map())

    expect(writtenPayload().currencies).toBeUndefined()
  })
})
