import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockRequireUser = vi.fn()
vi.mock('@/lib/api-auth', () => ({
  requireUser: () => mockRequireUser(),
  isAuthFailure: (r: any) => 'error' in r,
}))

vi.mock('@/lib/redis', () => ({
  invalidateUserCache: vi.fn(),
}))

vi.mock('@/lib/on-engine', () => ({
  processONTransaction: vi.fn(),
}))

const { GET } = await import('../route')

// ── Helpers ──────────────────────────────────────────────────────────────────

const { ledgerSupabase, trade } = await import('@/lib/__tests__/fixtures/ledger-supabase')
const on = (ticker: string, over: Record<string, unknown> = {}) => trade({ ticker, asset_type: 'ON', quantity: 200, price: 100, ...over })

const req = new Request('http://test.local/api/on-positions') as unknown as NextRequest

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/on-positions', () => {
  it('returns the open ON positions from the ledger core in the paginated shape', async () => {
    const supabase = ledgerSupabase({ transactions: [
      on('YM42D'), on('CS50D'), on('MGCRD'), on('MGCRD', { operation: 'VENTA', date: '2026-01-06' }), trade(),
    ] })
    mockRequireUser.mockResolvedValue({ supabase, user: { id: 'u1' } })

    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.map((p: any) => p.ticker)).toEqual(['CS50D', 'YM42D'])
    expect(body.data[0]).toMatchObject({ user_id: 'u1', ticker: 'CS50D', quantity: 200, avg_cost: 100, total_invested: 20000, first_bought: '2026-01-05' })
    expect(body.pagination).toEqual({ page: 1, limit: 50, total: 2, totalPages: 1 })
  })

  it('pages over a stable ticker order', async () => {
    const supabase = ledgerSupabase({ transactions: [on('YM42D'), on('CS50D')] })
    mockRequireUser.mockResolvedValue({ supabase, user: { id: 'u1' } })

    const body = await (await GET(new Request('http://test.local/api/on-positions?page=2&limit=1') as never)).json()

    expect(body.data.map((p: any) => p.ticker)).toEqual(['YM42D'])
    expect(body.pagination).toEqual({ page: 2, limit: 1, total: 2, totalPages: 2 })
  })
})

// ── Late loads (S2: the history derives from the ledger and rewrites itself) ──

describe('POST /api/on-positions — late load', () => {
  it('answers 201 with the write result only: no warnings, no snapshot read', async () => {
    const from = vi.fn(() => { throw new Error('unexpected table read') })
    mockRequireUser.mockResolvedValue({ user: { id: 'u1' }, supabase: { from } })
    const { processONTransaction } = await import('@/lib/on-engine')
    vi.mocked(processONTransaction).mockResolvedValue({ position: null, closedTrade: null })

    const { POST } = await import('../route')
    const res = await POST(new Request('http://localhost/api/on-positions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2026-07-02', ticker: 'DNCBD', operation: 'COMPRA', quantity: 250, price: 100.5 }),
    }) as never)

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ position: null, closedTrade: null })
    expect(from).not.toHaveBeenCalled()
  })
})

describe('POST /api/on-positions — the core refuses a sale of more than held (T5.1)', () => {
  it('answers 400 with the Spanish reason the ON form shows', async () => {
    const { POST } = await import('../route')
    const { processONTransaction } = await import('@/lib/on-engine')
    const { OversellError } = await import('@/lib/ledger-write')
    mockRequireUser.mockResolvedValue({ user: { id: 'u1' }, supabase: {} })
    vi.mocked(processONTransaction).mockRejectedValue(new OversellError({ kind: 'oversell', ticker: 'MGCRD', date: '2026-05-01', requested: 150, held: 100 }))

    const res = await POST(new Request('http://localhost/api/on-positions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2026-05-01', ticker: 'MGCRD', operation: 'VENTA', quantity: 150, price: 106 }),
    }))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('No podés vender 150 MGCRD el 2026-05-01: a esa fecha tenías 100.')
  })
})
