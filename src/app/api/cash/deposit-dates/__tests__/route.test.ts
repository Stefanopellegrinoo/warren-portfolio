import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRequireUser = vi.fn()
vi.mock('@/lib/api-auth', () => ({ requireUser: () => mockRequireUser(), isAuthFailure: (r: any) => 'error' in r }))
const mockGetDerivedSeries = vi.fn()
vi.mock('@/lib/derived-series', () => ({ getDerivedSeries: (...a: unknown[]) => mockGetDerivedSeries(...a) }))
vi.mock('@/lib/utils', async (orig) => ({ ...(await orig<object>()), argentinaDate: () => '2026-04-15' }))

const { GET } = await import('../route')
const { ledgerSupabase } = await import('@/lib/__tests__/fixtures/ledger-supabase')

const row = (id: string, type: string, amount: number, date: string, transaction_id: string | null = null) =>
  ({ id, user_id: 'u1', type, amount, date, transaction_id })

beforeEach(() => {
  vi.clearAllMocks()
  mockGetDerivedSeries.mockResolvedValue({ rows: [], income: [], degraded: false, degradedReasons: [], flags: {}, externalFlows: [], fundedDeposits: null })
})

describe('GET /api/cash/deposit-dates (odd/tasks/deposit-dates.md S2)', () => {
  it('proposes splitting a deposit recorded after the purchases it paid, by id, writing nothing', async () => {
    const log: string[] = []
    mockRequireUser.mockResolvedValue({
      supabase: ledgerSupabase({
        cash_movements: [
          row('a', 'RETIRO', 500, '2026-03-02', 'tx-a'), row('d1', 'DEPOSITO', 3000, '2026-03-31'),
          row('other', 'DEPOSITO', 999, '2026-03-01'), // another user's row the eq filter leaves out
        ].map((r, i) => (i === 2 ? { ...r, user_id: 'u2' } : r)),
      }, log),
      user: { id: 'u1' },
    })

    const res = await GET()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      deposits: [{ id: 'd1', date: '2026-03-31', amount: 3000, remaining: 2500, parts: [{ date: '2026-03-02', amount: 500 }] }],
      total: 500,
      from: '2026-03-02',
    })
    expect(log).toEqual(['cash_movements'])
    expect(mockGetDerivedSeries).toHaveBeenCalledWith(expect.anything(), 'u1')
  })

  it('a failed read is a 500, never an empty proposal', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockRequireUser.mockResolvedValue({ supabase: ledgerSupabase({ cash_movements: { error: { message: 'down' } } }), user: { id: 'u1' } })
    expect((await GET()).status).toBe(500)
    err.mockRestore()
  })

  it('asks for a session like every other route', async () => {
    mockRequireUser.mockResolvedValue({ error: new Response(null, { status: 401 }) })
    expect((await GET()).status).toBe(401)
  })
})
