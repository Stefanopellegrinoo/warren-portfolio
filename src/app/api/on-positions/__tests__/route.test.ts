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

/**
 * The columns `on_positions` actually has, queried from the live DB
 * (2026-08-01). There is no `created_at` — the table stamps `first_bought`
 * and `last_updated` instead (migration 003).
 */
const ON_POSITION_COLUMNS = new Set([
  'id',
  'user_id',
  'ticker',
  'quantity',
  'avg_cost',
  'total_invested',
  'first_bought',
  'last_updated',
  'version',
])

const position = (ticker: string) => ({
  id: `id-${ticker}`,
  user_id: 'u1',
  ticker,
  quantity: 200,
  avg_cost: 100,
  total_invested: 20000,
  first_bought: '2026-04-01',
  last_updated: '2026-04-01T17:30:20.194+00:00',
  version: 1,
})

/**
 * Chainable fake that rejects an unknown ORDER BY column the way PostgREST
 * does — code 42703, no rows. Ordering by a column the table lacks is not a
 * silent no-op there: it fails the whole request.
 */
function fakeSupabase(rows: unknown[]) {
  const orders: Array<{ column: string; ascending?: boolean }> = []
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    order: (column: string, opts: { ascending?: boolean } = {}) => {
      orders.push({ column, ...opts })
      return builder
    },
    range: (from: number, to: number) => {
      const unknown = orders.find((o) => !ON_POSITION_COLUMNS.has(o.column))
      if (unknown) {
        return Promise.resolve({
          data: null,
          count: null,
          error: {
            code: '42703',
            message: `column on_positions.${unknown.column} does not exist`,
          },
        })
      }
      return Promise.resolve({
        data: rows.slice(from, to + 1),
        count: rows.length,
        error: null,
      })
    },
  }
  return { client: { from: () => builder } as any, orders }
}

const req = new Request('http://test.local/api/on-positions') as unknown as NextRequest

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/on-positions', () => {
  it('returns the positions instead of 500ing on a column the table does not have', async () => {
    // Measured against the live DB 2026-08-01: ordering by created_at returns
    // `42703 column on_positions.created_at does not exist`, so this route
    // answered 500 for every user, always.
    const { client } = fakeSupabase([position('CS50D'), position('YM42D')])
    mockRequireUser.mockResolvedValue({ supabase: client, user: { id: 'u1' } })

    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toHaveLength(2)
    expect(body.pagination.total).toBe(2)
  })

  it('orders by a column on_positions actually has', async () => {
    const { client, orders } = fakeSupabase([position('CS50D')])
    mockRequireUser.mockResolvedValue({ supabase: client, user: { id: 'u1' } })

    await GET(req)

    expect(orders.length).toBeGreaterThan(0)
    for (const o of orders) {
      expect(ON_POSITION_COLUMNS.has(o.column)).toBe(true)
    }
  })

  it('breaks ties on a unique column so a paginated row cannot repeat or vanish', async () => {
    // The bulk import writes every row in one statement, so `last_updated`
    // ties across the whole table. Postgres does not promise a stable order
    // for equal keys, and this route is paginated: an unstable sort can serve
    // the same position on two pages and drop another entirely.
    const { client, orders } = fakeSupabase([position('CS50D')])
    mockRequireUser.mockResolvedValue({ supabase: client, user: { id: 'u1' } })

    await GET(req)

    expect(orders.length).toBeGreaterThanOrEqual(2)
    expect(orders[orders.length - 1].column).toBe('ticker')
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
