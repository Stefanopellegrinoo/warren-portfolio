import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRequireUser = vi.fn()
vi.mock('@/lib/api-auth', () => ({ requireUser: () => mockRequireUser(), isAuthFailure: (r: any) => 'error' in r }))

const { GET } = await import('../route')
const { ledgerSupabase, trade } = await import('@/lib/__tests__/fixtures/ledger-supabase')

const get = async (qs = '') => {
  const res = await GET(new Request(`http://test.local/api/transactions/closed${qs}`) as never)
  return { status: res.status, body: await res.json() }
}

beforeEach(() => vi.clearAllMocks())

describe('GET /api/transactions/closed', () => {
  it('lists realized stock sales from the ledger core, including one the stored table missed (L8)', async () => {
    mockRequireUser.mockResolvedValue({
      supabase: ledgerSupabase({ transactions: [
        trade({ ticker: 'VIST', quantity: 100, price: 43.64, date: '2026-03-02' }),
        trade({ ticker: 'VIST', operation: 'VENTA', quantity: 57.333333, price: 64.8508, date: '2026-04-09' }),
        trade(), trade({ operation: 'VENTA', quantity: 10, price: 90, date: '2026-05-01' }),
        trade({ ticker: 'ONA', asset_type: 'ON' }), trade({ ticker: 'ONA', asset_type: 'ON', operation: 'VENTA', date: '2026-05-02' }),
      ] }),
      user: { id: 'u1' },
    })

    const { status, body } = await get()

    expect(status).toBe(200)
    expect(Object.keys(body)).toEqual(['data', 'count'])
    expect(body.count).toBe(2)
    expect(body.data.map((t: any) => t.ticker)).toEqual(['AAPL', 'VIST'])
    expect(body.data[1]).toMatchObject({ open_date: '2026-03-02', close_date: '2026-04-09', days_held: 38, close_price: 64.8508 })
    expect(body.data[1].pnl).toBeCloseTo(1216.09, 2)
  })

  it('filters by ticker and pages with limit/offset', async () => {
    mockRequireUser.mockResolvedValue({
      supabase: ledgerSupabase({ transactions: [
        trade({ quantity: 3 }),
        trade({ operation: 'VENTA', quantity: 1, price: 110, date: '2026-02-01' }),
        trade({ operation: 'VENTA', quantity: 1, price: 120, date: '2026-03-01' }),
        trade({ ticker: 'MSFT' }), trade({ ticker: 'MSFT', operation: 'VENTA', date: '2026-04-01' }),
      ] }),
      user: { id: 'u1' },
    })

    const { body } = await get('?ticker=aapl&limit=1&offset=1')

    expect(body.count).toBe(2)
    expect(body.data.map((t: any) => t.close_date)).toEqual(['2026-02-01'])
  })
})
