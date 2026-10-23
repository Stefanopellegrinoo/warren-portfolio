import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRequireUser = vi.fn()
// Market tables are read with the service role (odd/tasks/security-hardening.md S12): the service
// client serves the same fixture the session does.
const h = vi.hoisted(() => ({ market: null as any }))
vi.mock('@/lib/supabase-server', () => ({ createServiceClient: () => h.market }))
vi.mock('@/lib/api-auth', () => ({ requireUser: async () => { const r = await mockRequireUser(); h.market = r?.supabase; return r }, isAuthFailure: (r: any) => 'error' in r }))
const mockFetchQuotes = vi.fn()
vi.mock('@/lib/yahoo-finance', () => ({ fetchQuotes: (...a: unknown[]) => mockFetchQuotes(...a), cachePrice: vi.fn(async () => {}) }))
const mockData912 = vi.fn()
vi.mock('@/lib/data912-client', () => ({ fetchData912Prices: (...a: unknown[]) => mockData912(...a) }))

const quotes = await import('../quotes/route')
const closed = await import('../closed/route')
const { ledgerSupabase, trade } = await import('@/lib/__tests__/fixtures/ledger-supabase')

const on = (over: Record<string, unknown> = {}) => trade({ ticker: 'ONA', asset_type: 'ON', quantity: 10, price: 95, ...over })

beforeEach(() => {
  vi.clearAllMocks()
  mockData912.mockResolvedValue(new Map())
})

describe('GET /api/on-positions/quotes', () => {
  it('quotes the ONs the ledger core holds, never reading on_positions', async () => {
    mockRequireUser.mockResolvedValue({ supabase: ledgerSupabase({ transactions: [on(), trade()] }), user: { id: 'u1' } })
    mockFetchQuotes.mockResolvedValue(new Map([['ONA', { ticker: 'ONA', price: 97 }]]))

    const body = await (await quotes.GET()).json()

    expect(mockFetchQuotes).toHaveBeenCalledWith(['ONA'])
    expect(body).toEqual({ quotes: { ONA: { ticker: 'ONA', price: 97 } } })
  })
})

describe('GET /api/on-positions/closed', () => {
  it('lists the realized ON sales from the ledger core, newest first', async () => {
    mockRequireUser.mockResolvedValue({
      supabase: ledgerSupabase({ transactions: [
        on(),
        on({ operation: 'VENTA', quantity: 4, price: 100, date: '2026-01-10' }),
        on({ operation: 'VENTA', quantity: 6, price: 90, date: '2026-01-20' }),
      ] }),
      user: { id: 'u1' },
    })

    const body = await (await closed.GET()).json()

    expect(body.closedTrades.map((t: any) => [t.close_date, t.quantity, t.close_price])).toEqual([
      ['2026-01-20', 6, 90], ['2026-01-10', 4, 100],
    ])
    expect(body.closedTrades[1]).toMatchObject({ ticker: 'ONA', open_date: '2026-01-05', days_held: 5, invested: 380, proceeds: 400, pnl: 20 })
  })
})
