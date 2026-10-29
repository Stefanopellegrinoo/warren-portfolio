import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRequireUser = vi.fn()
vi.mock('@/lib/api-auth', () => ({ requireUser: () => mockRequireUser(), isAuthFailure: (r: any) => 'error' in r }))
const mockGetDerivedSeries = vi.fn()
vi.mock('@/lib/derived-series', () => ({ getDerivedSeries: (...a: unknown[]) => mockGetDerivedSeries(...a) }))
vi.mock('@/lib/utils', async (orig) => ({ ...(await orig<object>()), argentinaDate: () => '2026-04-15' }))
const mockInvalidate = vi.fn()
vi.mock('@/lib/redis', () => ({ invalidateUserCache: (...a: unknown[]) => mockInvalidate(...a) }))

const { GET, POST } = await import('../route')
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

describe('POST /api/cash/deposit-dates (odd/tasks/deposit-dates.md S3)', () => {
  const D1 = '7d1c3f0e-5b8a-4c2e-9f6d-2a4b8e1c9d3f'
  const tables = () => ({ cash_movements: [row('a', 'RETIRO', 500, '2026-03-02', 'tx-a'), row('b', 'RETIRO', 250.12345, '2026-03-05', 'tx-b'), row(D1, 'DEPOSITO', 3000, '2026-03-31')] })
  const rpc = vi.fn()
  const signedIn = () => mockRequireUser.mockResolvedValue({ supabase: { ...ledgerSupabase(tables()), rpc }, user: { id: 'u1' } })
  const post = (body: unknown) => POST(new Request('http://x/api/cash/deposit-dates', { method: 'POST', body: JSON.stringify(body) }))
  const PROPOSED = { id: D1, parts: [{ date: '2026-03-02', amount: 500 }, { date: '2026-03-05', amount: 250.1235 }] }

  beforeEach(() => { rpc.mockResolvedValue({ data: 2, error: null }); signedIn() })

  it('saves the proposal as confirmed in one call, then drops every cache built on the old movements', async () => {
    const res = await post({ deposits: [PROPOSED] })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ saved: 2 })
    expect(rpc).toHaveBeenCalledTimes(1)
    // With the amount the deposit must still have: a second identical save finds it changed (verifier B2).
    expect(rpc).toHaveBeenCalledWith('redate_deposits', { p_changes: [{ ...PROPOSED, amount: 3000 }] })
    expect(mockInvalidate).toHaveBeenCalledWith('u1')
  })

  it('accepts a date the user moved earlier, as long as the amounts are the proposal\'s', async () => {
    const edited = { id: D1, parts: [{ date: '2026-02-20', amount: 500 }, { date: '2026-03-05', amount: 250.1235 }] }
    expect((await post({ deposits: [edited] })).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('redate_deposits', { p_changes: [{ ...edited, amount: 3000 }] })
  })

  it('a plan that is not the current proposal is refused with 409 and writes nothing', async () => {
    const res = await post({ deposits: [{ id: D1, parts: [{ date: '2026-03-02', amount: 750.1235 }] }] })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Tus movimientos cambiaron desde que se armó la propuesta: revisala de nuevo.' })
    expect(rpc).not.toHaveBeenCalled()
    expect(mockInvalidate).not.toHaveBeenCalled()
  })

  it('a date on the deposit\'s day or after today is refused with 400 and writes nothing', async () => {
    const late = await post({ deposits: [{ id: D1, parts: [{ date: '2026-03-31', amount: 500 }, PROPOSED.parts[1]] }] })
    expect(late.status).toBe(400)
    expect((await late.json()).error).toBe('Cada parte tiene que tener una fecha anterior a la de su depósito.')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('a malformed plan is a 400 with the reason in Spanish, before any read', async () => {
    const res = await post({ deposits: [] })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('No hay depósitos para guardar')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('when the database refuses (a deposit changed meanwhile) it says so, and nothing is invalidated', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'redate_deposits: the parts exceed deposit x', code: 'P0001' } })
    const res = await post({ deposits: [PROPOSED] })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Tus movimientos cambiaron desde que se armó la propuesta: revisala de nuevo.')
    expect(mockInvalidate).not.toHaveBeenCalled()
  })
})

