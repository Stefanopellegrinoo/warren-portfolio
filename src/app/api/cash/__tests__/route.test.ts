import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRequireUser = vi.fn()
vi.mock('@/lib/api-auth', () => ({ requireUser: () => mockRequireUser(), isAuthFailure: (r: any) => 'error' in r }))
vi.mock('@/lib/on-schedules', () => ({
  loadSchedules: vi.fn(async () => new Map([['ONA', [{ date: '2026-02-10', ren: 2, amo: 0 }]]])),
}))
vi.mock('@/lib/utils', async (orig) => ({ ...(await orig<object>()), argentinaDate: () => '2026-03-01' }))

const { GET } = await import('../route')
const { ledgerSupabase, trade, movement } = await import('@/lib/__tests__/fixtures/ledger-supabase')

beforeEach(() => vi.clearAllMocks())

describe('GET /api/cash', () => {
  it('answers the ledger cash, automatic ON coupons included, never reading cash_balance', async () => {
    mockRequireUser.mockResolvedValue({
      supabase: ledgerSupabase({
        transactions: [trade({ ticker: 'ONA', asset_type: 'ON', quantity: 10, price: 95 })],
        cash_movements: [movement({ amount: 1000 }), movement({ type: 'COMPRA', amount: 950, date: '2026-01-05' })],
      }),
      user: { id: 'u1' },
    })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ balance: { user_id: 'u1', balance: 70 } })
  })

  it('a failed ledger read is a 500, not a zero balance', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockRequireUser.mockResolvedValue({ supabase: ledgerSupabase({ cash_movements: { error: { message: 'down' } } }), user: { id: 'u1' } })

    expect((await GET()).status).toBe(500)
    err.mockRestore()
  })
})
