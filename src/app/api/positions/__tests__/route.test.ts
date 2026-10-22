import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockRequireUser = vi.fn()
vi.mock('@/lib/api-auth', () => ({
  requireUser: () => mockRequireUser(),
  isAuthFailure: (r: any) => 'error' in r,
}))

const mockFetchQuotesWithFallback = vi.fn()
vi.mock('@/lib/yahoo-finance', () => ({
  fetchQuotesWithFallback: (...args: unknown[]) => mockFetchQuotesWithFallback(...args),
}))

const mockFetchONQuotesWithFallback = vi.fn()
vi.mock('@/lib/data912-client', () => ({
  fetchONQuotesWithFallback: (...args: unknown[]) => mockFetchONQuotesWithFallback(...args),
}))

vi.mock('@/lib/redis', () => ({
  getRedis: () => null,
  ensureRedisConnected: async () => false,
}))

const { GET } = await import('../route')

// ── Helpers ──────────────────────────────────────────────────────────────────

const { ledgerSupabase, trade, movement } = await import('@/lib/__tests__/fixtures/ledger-supabase')

function quote(ticker: string, price: number) {
  return { ticker, price, change: 0, changePercent: 0, previousClose: price }
}

const req = new Request('http://test.local/api/positions') as unknown as NextRequest

beforeEach(() => {
  vi.clearAllMocks()
  mockFetchQuotesWithFallback.mockResolvedValue(new Map())
  mockFetchONQuotesWithFallback.mockResolvedValue(new Map())
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/positions — the ledger core and the one valuation rule', () => {
  it('marks an unpriced position at its own cost and keeps the response shape', async () => {
    // Arrange — AAPL quoted @150; MISS has no quote; cash 1700 − 1500 = 200
    const supabase = ledgerSupabase({
      transactions: [trade(), trade({ ticker: 'MISS', quantity: 5 })],
      cash_movements: [movement({ amount: 1700 }), movement({ type: 'COMPRA', amount: 1500, date: '2026-01-05' })],
    })
    mockRequireUser.mockResolvedValue({ supabase, user: { id: 'u1' } })
    mockFetchQuotesWithFallback.mockResolvedValue(new Map([['AAPL', quote('AAPL', 150)]]))

    // Act
    const res = await GET(req)
    const body = await res.json()

    // Assert
    expect(res.status).toBe(200)
    expect(Object.keys(body)).toEqual(['positions', 'onPositions', 'summary', 'unpricedCount', 'unpricedTickers', 'lastRefresh'])
    expect(body.summary.total_market_value).toBe(2200) // 10×150 + MISS at cost 500 + 200 cash
    expect(body.summary.total_invested).toBe(1500)
    expect(body.summary.open_pnl).toBe(500)
    expect(body.summary.cash.balance).toBe(200)
    const miss = body.positions.find((p: any) => p.ticker === 'MISS')
    expect(miss).toMatchObject({ quantity: 5, avg_cost: 100, total_invested: 500, market_value: 500 })
  })

  it('surfaces how many positions have no live price', async () => {
    const supabase = ledgerSupabase({ transactions: [trade(), trade({ ticker: 'BCBA:GGAL', quantity: 5 })] })
    mockRequireUser.mockResolvedValue({ supabase, user: { id: 'u1' } })
    mockFetchQuotesWithFallback.mockResolvedValue(new Map([['AAPL', quote('AAPL', 150)]]))

    const body = await (await GET(req)).json()
    expect(body.unpricedCount).toBe(1)
    expect(body.unpricedTickers).toEqual(['BCBA:GGAL'])
  })

  it('reports zero unpriced positions when every quote is present', async () => {
    const supabase = ledgerSupabase({ transactions: [trade()] })
    mockRequireUser.mockResolvedValue({ supabase, user: { id: 'u1' } })
    mockFetchQuotesWithFallback.mockResolvedValue(new Map([['AAPL', quote('AAPL', 150)]]))
    expect((await (await GET(req)).json()).unpricedCount).toBe(0)
  })

  it('values an unquoted ON at its last recorded close', async () => {
    const supabase = ledgerSupabase({
      transactions: [trade({ ticker: 'ONA', asset_type: 'ON', price: 95 })],
      on_price_history: [{ ticker: 'ONA', price_date: '2026-01-20', close: 98 }],
      on_terms: [],
    })
    mockRequireUser.mockResolvedValue({ supabase, user: { id: 'u1' } })

    const body = await (await GET(req)).json()
    expect(body.onPositions[0]).toMatchObject({ ticker: 'ONA', market_value: 980 })
    expect(body.summary.ons.pnl).toBeCloseTo(30)
  })

  it('realizes a sale the stored closed_trades missed (L8)', async () => {
    const supabase = ledgerSupabase({ transactions: [
      trade({ ticker: 'VIST', quantity: 100, price: 43.64, date: '2026-03-02' }),
      trade({ ticker: 'VIST', operation: 'VENTA', quantity: 57.333333, price: 64.8508, date: '2026-04-09' }),
    ] })
    mockRequireUser.mockResolvedValue({ supabase, user: { id: 'u1' } })

    const body = await (await GET(req)).json()
    expect(body.summary.realized_pnl).toBeCloseTo(1216.09, 2)
  })

  it('returns a cash-only summary for an empty portfolio', async () => {
    // Arrange
    const supabase = ledgerSupabase({ cash_movements: [movement({ amount: 300 })] })
    mockRequireUser.mockResolvedValue({ supabase, user: { id: 'u1' } })

    // Act
    const res = await GET(req)
    const body = await res.json()

    // Assert
    expect(res.status).toBe(200)
    expect(body.summary.total_market_value).toBe(300)
    expect(body.summary.cash.balance).toBe(300)
    expect(body.positions).toEqual([])
    expect(body.lastRefresh).toBeNull()
  })
})
