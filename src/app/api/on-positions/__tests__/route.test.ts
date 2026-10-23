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

// ── Retroactive-entry warning ────────────────────────────────────────────────

/**
 * Minimal PostgREST chain matching `fetchSnapshotSeries` — the canonical,
 * paginated read path `retroactiveWarnings` now routes through:
 * .select('*').eq().gte().order().range() resolves to `result` on the FIRST
 * `.range()` call and an empty page on any further one, so a single-page stub
 * still terminates the pagination loop correctly.
 *
 * Records the table name and each call's arguments so a test can assert the
 * query shape actually reached — not just that some response came back — the
 * same contract `transactions/route.test.ts` checks for the sibling route.
 * Keeping this property was the whole point of an earlier fix round (see
 * `src/lib/api/__tests__/retroactive-warning.test.ts` for the pagination
 * regression this shape itself guards against).
 */
function stubSnapshots(result: { data: unknown[] | null; error: unknown }) {
  const calls: { table?: string; select?: string; eq?: [string, unknown]; gte?: [string, unknown]; range?: [number, number] } = {}
  let served = false
  const chain: Record<string, unknown> = {}
  chain.select = (columns: string) => {
    calls.select = columns
    return chain
  }
  chain.eq = (column: string, value: unknown) => {
    calls.eq = [column, value]
    return chain
  }
  chain.gte = (column: string, value: unknown) => {
    calls.gte = [column, value]
    return chain
  }
  chain.order = () => chain
  chain.range = (from: number, to: number) => {
    calls.range = [from, to]
    if (served) return Promise.resolve({ data: [], error: null })
    served = true
    return Promise.resolve(result)
  }
  const supabase = {
    from: (table: string) => {
      calls.table = table
      if (table !== 'portfolio_snapshots') throw new Error(`unexpected table ${table}`)
      return chain
    },
  }
  return { supabase, calls }
}

const retroactiveRequest = () =>
  new Request('http://localhost/api/on-positions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date: '2026-07-02', ticker: 'DNCBD', operation: 'COMPRA', quantity: 250, price: 100.5,
    }),
  }) as never

describe('POST /api/on-positions — retroactive-entry warning', () => {
  it('warns on the ON route too — DNCBD came in through here, not /api/transactions', async () => {
    const { supabase, calls } = stubSnapshots({
      data: [{ snapshot_date: '2026-07-23', source: 'live' }],
      error: null,
    })
    mockRequireUser.mockResolvedValue({ user: { id: 'u1' }, supabase })

    const { processONTransaction } = await import('@/lib/on-engine')
    vi.mocked(processONTransaction).mockResolvedValue({ position: null, closedTrade: null })

    const { POST } = await import('../route')
    const res = await POST(retroactiveRequest())
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.warnings).toEqual([
      { code: 'RETROACTIVE_ENTRY', entryDate: '2026-07-02', staleSnapshots: ['2026-07-23'] },
    ])
    expect(calls.table).toBe('portfolio_snapshots')
    expect(calls.select).toBe('*')
    expect(calls.eq).toEqual(['user_id', 'u1'])
    expect(calls.gte).toEqual(['snapshot_date', '2026-07-02'])
    expect(calls.range).toEqual([0, 999])
  })

  it('still returns 201 when the snapshot read fails — the write already committed', async () => {
    // Global Constraints bind BOTH routes to fail-open, and this route is the
    // feature's motivating case (DNCBD came in here, not /api/transactions),
    // so the fail-open behaviour needs its own coverage here too.
    const { supabase, calls } = stubSnapshots({ data: null, error: { message: 'connection reset' } })
    mockRequireUser.mockResolvedValue({ user: { id: 'u1' }, supabase })

    const { processONTransaction } = await import('@/lib/on-engine')
    vi.mocked(processONTransaction).mockResolvedValue({ position: null, closedTrade: null })

    const { POST } = await import('../route')
    const res = await POST(retroactiveRequest())
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.warnings).toBeUndefined()
    expect(vi.mocked(processONTransaction)).toHaveBeenCalledOnce()
    // Proves the query was actually attempted and reached the error branch,
    // not that the helper was never invoked in the first place.
    expect(calls.table).toBe('portfolio_snapshots')
    expect(calls.select).toBe('*')
    expect(calls.eq).toEqual(['user_id', 'u1'])
    expect(calls.gte).toEqual(['snapshot_date', '2026-07-02'])
  })

  // The 1000-row pagination behaviour itself (the failure mode this stub's
  // shape guards against — see the module docblock on `retroactive-warning.ts`)
  // is pinned directly against `retroactiveWarnings` in
  // `src/lib/api/__tests__/retroactive-warning.test.ts`, not re-derived here.
})
