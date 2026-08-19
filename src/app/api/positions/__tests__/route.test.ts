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

/**
 * Chainable fake for the getFullPortfolio query shapes:
 *   from(t).select('*').eq(...).order(...)      → { data }
 *   from(t).select('*').eq(...)                 → { data }   (awaited directly)
 *   from('cash_balance').select('balance').eq(...).single() → { data: { balance } }
 */
function clientWith(tables: Record<string, any[]>, cashBalance: number) {
  const ok = (data: any) => ({ data, error: null })
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () =>
          Object.assign(Promise.resolve(ok(tables[table] ?? [])), {
            order: () => Promise.resolve(ok(tables[table] ?? [])),
            single: () => Promise.resolve(ok({ balance: cashBalance })),
          }),
      }),
    }),
  }
}

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

describe('GET /api/positions — characterization before valuation refactor', () => {
  it('drops an unpriced position from the totals but keeps it in the response', async () => {
    // Arrange — AAPL quoted @150; MISS has no quote
    const supabase = clientWith(
      {
        positions: [
          { user_id: 'u1', ticker: 'AAPL', quantity: 10, avg_cost: 100, total_invested: 1000 },
          { user_id: 'u1', ticker: 'MISS', quantity: 5, avg_cost: 100, total_invested: 500 },
        ],
        on_positions: [],
        closed_trades: [],
        on_closed_trades: [],
      },
      200
    )
    mockRequireUser.mockResolvedValue({ supabase, user: { id: 'u1' } })
    mockFetchQuotesWithFallback.mockResolvedValue(new Map([['AAPL', quote('AAPL', 150)]]))

    // Act
    const res = await GET(req)
    const body = await res.json()

    // Assert — today's exact dashboard numbers, pinned
    expect(res.status).toBe(200)
    expect(body.summary.total_market_value).toBe(1700) // 10×150 + 200 cash
    expect(body.summary.total_invested).toBe(1000)     // MISS's invested dropped too
    expect(body.summary.open_pnl).toBe(500)
    expect(body.summary.cash.balance).toBe(200)
    expect(body.positions).toHaveLength(2)
    const miss = body.positions.find((p: any) => p.ticker === 'MISS')
    expect(miss.market_value).toBeUndefined()
  })

  it('returns a cash-only summary for an empty portfolio', async () => {
    // Arrange
    const supabase = clientWith(
      { positions: [], on_positions: [], closed_trades: [], on_closed_trades: [] },
      300
    )
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
