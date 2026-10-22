import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRequireUser = vi.fn()
vi.mock('@/lib/api-auth', () => ({ requireUser: () => mockRequireUser(), isAuthFailure: (r: any) => 'error' in r }))
vi.mock('@/lib/redis', () => ({ getCachedRoute: async () => null, cacheRoute: async () => {} }))
const mockStockQuotes = vi.fn()
vi.mock('@/lib/yahoo-finance', () => ({ fetchQuotes: (...a: unknown[]) => mockStockQuotes(...a) }))
vi.mock('@/lib/data912-client', () => ({ fetchONQuotes: async () => new Map() }))

const { GET } = await import('../route')
const { ledgerSupabase, trade, movement } = await import('@/lib/__tests__/fixtures/ledger-supabase')

const quote = (ticker: string, price: number) => ({ ticker, price, change: 0, changePercent: 0, previousClose: price })

beforeEach(() => vi.clearAllMocks())

describe('GET /api/statistics/combined', () => {
  it('composes stocks, ONs and cash from the ledger core; a missing quote is valued, never 0', async () => {
    mockRequireUser.mockResolvedValue({
      supabase: ledgerSupabase({
        transactions: [
          trade(), trade({ operation: 'VENTA', quantity: 2, price: 120, date: '2026-01-06' }),
          trade({ ticker: 'MISS', quantity: 1, price: 50 }),
          trade({ ticker: 'ONA', asset_type: 'ON', quantity: 10, price: 95 }),
        ],
        on_price_history: [{ ticker: 'ONA', price_date: '2026-01-20', close: 98 }],
        cash_movements: [movement({ amount: 300 })],
      }),
      user: { id: 'u1' },
    })
    mockStockQuotes.mockResolvedValue(new Map([['AAPL', quote('AAPL', 150)]]))

    const res = await GET({} as never)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(Object.keys(body)).toEqual(['totalValue', 'composition', 'stocks', 'ons'])
    // AAPL 8 × 150 + MISS at cost 50; ONA at its last close 98 × 10; cash 300
    expect(body.stocks).toEqual({ value: 1250, openPnl: 400, realizedPnl: 40, totalPnl: 440, positionCount: 2, closedTradesCount: 1 })
    expect(body.ons).toMatchObject({ value: 980, realizedPnl: 0, positionCount: 1, closedTradesCount: 0 })
    expect(body.ons.openPnl).toBeCloseTo(30)
    expect(body.totalValue).toBe(1250 + 980 + 300)
    expect(body.composition.map((c: any) => c.name)).toEqual(['Acciones', 'ONs', 'Efectivo'])
  })
})
