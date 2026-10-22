/**
 * /api/positions when it computes the summary itself (no cached one): the
 * existing fields are what they were, and the currency views are an addition
 * whose failure never fails the response.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockViews = vi.fn()
const mockCtx = vi.fn()
const ok = (data: unknown) => ({ data, error: null })
const tables: Record<string, unknown[]> = {
  positions: [{ user_id: 'u1', ticker: 'AAPL', quantity: 2, avg_cost: 100, total_invested: 200 }],
  on_positions: [], closed_trades: [{ pnl: 5 }], on_closed_trades: [],
}
// The getFullPortfolio query shapes, as in route.test.ts.
const supabase = {
  from: (table: string) => ({
    select: () => ({
      eq: () => Object.assign(Promise.resolve(ok(tables[table] ?? [])), {
        order: () => Promise.resolve(ok(tables[table] ?? [])),
        single: () => Promise.resolve(ok({ balance: 50 })),
      }),
    }),
  }),
}
vi.mock('@/lib/api-auth', () => ({
  requireUser: async () => ({ supabase, user: { id: 'u1' } }),
  isAuthFailure: () => false,
}))
vi.mock('@/lib/redis', () => ({ ensureRedisConnected: async () => false, getRedis: () => null }))
vi.mock('@/lib/yahoo-finance', () => ({
  fetchQuotesWithFallback: async () => new Map([['AAPL', { ticker: 'AAPL', price: 150, change: 1, changePercent: 0.01, previousClose: 149 }]]),
}))
vi.mock('@/lib/data912-client', () => ({ fetchONQuotesWithFallback: async () => new Map() }))
vi.mock('@/lib/currency-views', () => ({
  loadCurrencyContext: (...a: unknown[]) => mockCtx(...a),
  currencyViewsFor: (...a: unknown[]) => mockViews(...a),
}))

const { GET } = await import('../route')

beforeEach(() => {
  vi.clearAllMocks()
  mockCtx.mockResolvedValue({ fx: {}, ratios: new Map() })
  mockViews.mockResolvedValue({ version: 1 })
})

async function get() {
  const res = await GET({} as never)
  return { status: res.status, body: await res.json() }
}

describe('GET /api/positions without a cached summary', () => {
  it('keeps the existing fields and adds the currency views of the valued positions', async () => {
    const { status, body } = await get()

    expect(status).toBe(200)
    expect(body.positions[0]).toMatchObject({ ticker: 'AAPL', market_value: 300, pnl: 100, day_change: 2 })
    expect(body.summary).toMatchObject({ total_market_value: 350, total_invested: 200, open_pnl: 100, realized_pnl: 5 })
    expect(body.summary.cash).toEqual({ balance: 50 })
    expect(body.unpricedCount).toBe(0)
    expect(body.lastRefresh).toBeNull()
    expect(body.currencies).toEqual({ version: 1 })
    const [, userId, , valued] = mockViews.mock.calls[0]
    expect(userId).toBe('u1')
    expect(valued.cashBalance).toBe(50)
    expect(valued.positions[0].market_value).toBe(300)
  })

  it('a currency views failure still answers 200 with the existing fields only', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockViews.mockRejectedValue(new Error('fx_rates down'))

    const { status, body } = await get()

    expect(status).toBe(200)
    expect(body.summary.total_market_value).toBe(350)
    expect('currencies' in body).toBe(false)
    errSpy.mockRestore()
  })
})
