import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRequireUser = vi.fn()
// Market tables are read with the service role (odd/tasks/security-hardening.md S12): the service
// client serves the same fixture the session does.
const h = vi.hoisted(() => ({ market: null as any }))
vi.mock('@/lib/supabase-server', () => ({ createServiceClient: () => h.market }))
vi.mock('@/lib/api-auth', () => ({ requireUser: async () => { const r = await mockRequireUser(); h.market = r?.supabase; return r }, isAuthFailure: (r: any) => 'error' in r }))
vi.mock('@/lib/redis', () => ({ getCachedRoute: async () => null, cacheRoute: async () => {} }))
const mockStockQuotes = vi.fn()
vi.mock('@/lib/yahoo-finance', () => ({ fetchQuotes: (...a: unknown[]) => mockStockQuotes(...a) }))
const mockFullDownload = vi.fn(async () => { throw new Error('uncached data912 download') })
const mockOnQuotes = vi.fn()
vi.mock('@/lib/data912-client', () => ({
  fetchONQuotes: (...a: unknown[]) => mockFullDownload(...(a as [])),
  fetchONQuotesWithFallback: (...a: unknown[]) => mockOnQuotes(...a),
}))

const { GET } = await import('../route')
const { ledgerSupabase, trade, movement } = await import('@/lib/__tests__/fixtures/ledger-supabase')

const quote = (ticker: string, price: number) => ({ ticker, price, change: 0, changePercent: 0, previousClose: price })

beforeEach(() => {
  vi.clearAllMocks()
  mockOnQuotes.mockResolvedValue(new Map())
})

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

  it('values ONs with the Redis-first quotes, never the full data912 download, asked together with the stock quotes', async () => {
    mockRequireUser.mockResolvedValue({
      supabase: ledgerSupabase({ transactions: [trade(), trade({ ticker: 'ONA', asset_type: 'ON', quantity: 10, price: 95 })] }),
      user: { id: 'u1' },
    })
    let answerStocks!: (m: Map<string, unknown>) => void
    mockStockQuotes.mockReturnValue(new Promise(r => { answerStocks = r }))
    mockOnQuotes.mockResolvedValue(new Map([['ONA', quote('ONA', 99)]]))

    const pending = GET({} as never)
    // The stock quotes have not answered yet and the ON quotes are already asked for.
    await vi.waitFor(() => expect(mockOnQuotes).toHaveBeenCalledWith(['ONA']))
    answerStocks(new Map([['AAPL', quote('AAPL', 150)]]))
    const body = await (await pending).json()

    expect(mockFullDownload).not.toHaveBeenCalled()
    expect(body.ons).toMatchObject({ value: 990, positionCount: 1 })
    expect(body.stocks.value).toBe(1500)
  })
})
