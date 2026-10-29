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

beforeEach(() => {
  vi.clearAllMocks()
  mockOnQuotes.mockResolvedValue(new Map())
})

describe('GET /api/statistics/combined', () => {
  it('counts open positions and closed trades per class from the ledger core, without asking for a quote', async () => {
    mockRequireUser.mockResolvedValue({
      supabase: ledgerSupabase({
        transactions: [
          trade(), trade({ operation: 'VENTA', quantity: 2, price: 120, date: '2026-01-06' }),
          trade({ ticker: 'MISS', quantity: 1, price: 50 }),
          trade({ ticker: 'ONA', asset_type: 'ON', quantity: 10, price: 95 }),
        ],
        cash_movements: [movement({ amount: 300 })],
      }),
      user: { id: 'u1' },
    })

    const res = await GET({} as never)
    const body = await res.json()

    expect(res.status).toBe(200)
    // Value, results and composition come from the dashboard's own answer (odd/tasks/statistics-truth.md S1).
    expect(body).toEqual({
      stocks: { positionCount: 2, closedTradesCount: 1 },
      ons: { positionCount: 1, closedTradesCount: 0 },
    })
    expect(mockStockQuotes).not.toHaveBeenCalled()
    expect(mockOnQuotes).not.toHaveBeenCalled()
    expect(mockFullDownload).not.toHaveBeenCalled()
  })
})
