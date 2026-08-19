import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockProcessTransaction = vi.fn()
vi.mock('@/lib/portfolio-engine', () => ({ processTransaction: (...a: unknown[]) => mockProcessTransaction(...a) }))

const mockInvalidate = vi.fn()
vi.mock('@/lib/redis', () => ({ invalidateUserCache: (...a: unknown[]) => mockInvalidate(...a) }))

const mockResolve = vi.fn()
vi.mock('@/lib/ticker-identity', () => ({ resolveTickerIdentity: (...a: unknown[]) => mockResolve(...a) }))

const mockGetCatalogued = vi.fn()
const mockUpsertIdentity = vi.fn()
vi.mock('@/lib/ticker-catalog', () => ({
  getCataloguedTicker: (...a: unknown[]) => mockGetCatalogued(...a),
  upsertTickerIdentity: (...a: unknown[]) => mockUpsertIdentity(...a),
}))

const mockRequireUser = vi.fn()
const mockIsAuthFailure = vi.fn()
vi.mock('@/lib/api-auth', () => ({ requireUser: mockRequireUser, isAuthFailure: mockIsAuthFailure }))

// Two distinct client objects so the test can tell WHICH one each catalog call
// received. `ticker_identity` is service-role-write (migration 032), so a write
// on the user-scoped client is denied by RLS at runtime.
const userClient = { __client: 'user-scoped' }
const serviceClient = { __client: 'service-role' }
const mockCreateServiceClient = vi.fn(() => serviceClient)
vi.mock('@/lib/supabase-server', () => ({ createServiceClient: () => mockCreateServiceClient() }))

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validBody = {
  date: '2026-04-15',
  ticker: 'UN',
  operation: 'COMPRA',
  quantity: 1769,
  price: 14.2983,
  assetType: 'CEDEAR',
}

/**
 * Minimal PostgREST chain matching `fetchSnapshotSeries` — the canonical,
 * paginated read path `retroactiveWarnings` now routes through:
 * .select('*').eq().gte().order().range() resolves to `result` on the FIRST
 * `.range()` call and an empty page on any further one, so a single-page
 * stub still terminates the pagination loop correctly.
 *
 * Records the table name and each call's arguments so a test can assert the
 * query shape — not just that SOME response came back — and so a route that
 * stops calling the warning helper leaves `calls.table` unset, which fails
 * every test built on top of this rather than passing silently. Keeping this
 * property was the whole point of an earlier fix round (see
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
  ;(userClient as Record<string, unknown>).from = (table: string) => {
    calls.table = table
    if (table !== 'portfolio_snapshots') throw new Error(`unexpected table ${table}`)
    return chain
  }
  return calls
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireUser.mockResolvedValue({ user: { id: 'user-1' }, supabase: userClient })
  mockIsAuthFailure.mockReturnValue(false)
  mockProcessTransaction.mockResolvedValue({ id: 'tx-1' })
  mockInvalidate.mockResolvedValue(undefined)
  mockUpsertIdentity.mockResolvedValue(undefined)
  mockCreateServiceClient.mockReturnValue(serviceClient)
  // Every 201 response now reaches retroactiveWarnings. Without a default
  // `.from`, `userClient` (a plain object with no Supabase client behind it)
  // throws a TypeError there, which the helper swallows — so these
  // ticker-identity tests would stay green while silently exercising a
  // catch-and-log branch that logs on every run. Route through a real
  // "no snapshots, no warnings" path instead, so the suite stays pristine
  // under any reporter, verbose included.
  stubSnapshots({ data: [], error: null })
})

describe('POST /api/transactions — ticker identity gate', () => {
  it('refuses an uncatalogued ticker with 409 and writes nothing', async () => {
    const { POST } = await import('./route')
    mockGetCatalogued.mockResolvedValue(null)
    mockResolve.mockResolvedValue({
      found: true,
      identity: { ticker: 'UN', yahooSymbol: 'UN', name: 'Corgi UNH 2x Daily ETF', exchange: 'Cboe US', price: 25.0261 },
    })

    const res = await POST(makeRequest(validBody))

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      code: 'TICKER_UNCONFIRMED',
      resolution: { found: true, identity: { name: 'Corgi UNH 2x Daily ETF' } },
    })
    expect(mockProcessTransaction).not.toHaveBeenCalled()
    expect(mockUpsertIdentity).not.toHaveBeenCalled()
  })

  it('creates the transaction and catalogues the ticker when confirmed', async () => {
    const { POST } = await import('./route')
    mockGetCatalogued.mockResolvedValue(null)
    const resolution = {
      found: true,
      identity: { ticker: 'PLTR', yahooSymbol: 'PLTR', name: 'Palantir Technologies Inc.', exchange: 'NasdaqGS', price: 60 },
    }
    mockResolve.mockResolvedValue(resolution)

    const res = await POST(makeRequest({ ...validBody, ticker: 'PLTR', confirmTicker: true }))

    expect(res.status).toBe(201)
    expect(mockUpsertIdentity).toHaveBeenCalledWith(expect.anything(), resolution, 'PLTR')
    expect(mockProcessTransaction).toHaveBeenCalled()
  })

  it('writes the catalog with the service client, not the request-scoped one RLS would deny', async () => {
    const { POST } = await import('./route')
    mockGetCatalogued.mockResolvedValue(null)
    const resolution = {
      found: true,
      identity: { ticker: 'PLTR', yahooSymbol: 'PLTR', name: 'Palantir Technologies Inc.', exchange: 'NasdaqGS', price: 60 },
    }
    mockResolve.mockResolvedValue(resolution)

    const res = await POST(makeRequest({ ...validBody, ticker: 'PLTR', confirmTicker: true }))

    expect(res.status).toBe(201)
    // The read stays on the user's session — the SELECT policy allows it.
    expect(mockGetCatalogued).toHaveBeenCalledWith(userClient, 'PLTR')
    // The write must NOT reuse it: migration 032 grants writes TO service_role
    // only, so an anon-key client is denied and the whole gate jams shut.
    expect(mockUpsertIdentity).toHaveBeenCalledWith(serviceClient, resolution, 'PLTR')
    const readClient = mockGetCatalogued.mock.calls[0][0]
    const writeClient = mockUpsertIdentity.mock.calls[0][0]
    expect(writeClient).not.toBe(readClient)
  })

  it('lets an already-catalogued ticker through untouched', async () => {
    const { POST } = await import('./route')
    mockGetCatalogued.mockResolvedValue({
      ticker: 'NVDA', yahoo_symbol: 'NVDA', confirmed_name: 'NVIDIA Corporation', exchange: 'NasdaqGS', last_checked_at: null,
    })

    const res = await POST(makeRequest({ ...validBody, ticker: 'NVDA' }))

    expect(res.status).toBe(201)
    expect(mockResolve).not.toHaveBeenCalled()
    expect(mockUpsertIdentity).not.toHaveBeenCalled()
  })

  it('bypasses the gate entirely for ONs, which Data912 prices and Yahoo does not know', async () => {
    const { POST } = await import('./route')

    const res = await POST(makeRequest({ ...validBody, ticker: 'MGCRD', assetType: 'ON' }))

    expect(res.status).toBe(201)
    expect(mockGetCatalogued).not.toHaveBeenCalled()
    expect(mockResolve).not.toHaveBeenCalled()
  })

  it('gates a transaction with no assetType — an omitted type is a stock, not an exemption', async () => {
    const { POST } = await import('./route')
    mockGetCatalogued.mockResolvedValue(null)
    mockResolve.mockResolvedValue({ found: false, reason: 'not-found' })
    const { assetType, ...noType } = validBody

    const res = await POST(makeRequest(noType))

    expect(res.status).toBe(409)
    expect(mockProcessTransaction).not.toHaveBeenCalled()
  })

  it('confirms an unresolvable ticker into the catalog rather than blocking forever', async () => {
    const { POST } = await import('./route')
    mockGetCatalogued.mockResolvedValue(null)
    const resolution = { found: false, reason: 'not-found' }
    mockResolve.mockResolvedValue(resolution)

    const res = await POST(makeRequest({ ...validBody, ticker: 'MYTHING', confirmTicker: true }))

    expect(res.status).toBe(201)
    expect(mockUpsertIdentity).toHaveBeenCalledWith(expect.anything(), resolution, 'MYTHING')
  })

  it('returns 503 and writes nothing when Yahoo cannot be reached', async () => {
    const { POST } = await import('./route')
    mockGetCatalogued.mockResolvedValue(null)
    mockResolve.mockRejectedValue(new Error('yahoo down'))

    const res = await POST(makeRequest(validBody))

    expect(res.status).toBe(503)
    expect(mockProcessTransaction).not.toHaveBeenCalled()
  })

  it('fails the request when the catalog write fails, so the catalog never lags the ledger', async () => {
    const { POST } = await import('./route')
    mockGetCatalogued.mockResolvedValue(null)
    mockResolve.mockResolvedValue({ found: false, reason: 'not-found' })
    mockUpsertIdentity.mockRejectedValue(new Error('permission denied'))

    const res = await POST(makeRequest({ ...validBody, confirmTicker: true }))

    expect(res.status).toBe(500)
    expect(mockProcessTransaction).not.toHaveBeenCalled()
  })
})

// ── Retroactive-entry warning ────────────────────────────────────────────────

describe('POST /api/transactions — retroactive-entry warning', () => {
  beforeEach(() => {
    mockGetCatalogued.mockResolvedValue({ ticker: 'UN', yahoo_symbol: 'UN' })
  })

  it('attaches a warning naming the measured rows already written', async () => {
    const calls = stubSnapshots({ data: [{ snapshot_date: '2026-07-23', source: 'live' }], error: null })
    const { POST } = await import('./route')

    const res = await POST(makeRequest({ ...validBody, date: '2026-07-02' }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.warnings).toEqual([
      { code: 'RETROACTIVE_ENTRY', entryDate: '2026-07-02', staleSnapshots: ['2026-07-23'] },
    ])
    expect(calls.table).toBe('portfolio_snapshots')
    expect(calls.select).toBe('*')
    expect(calls.eq).toEqual(['user_id', 'user-1'])
    expect(calls.gte).toEqual(['snapshot_date', '2026-07-02'])
    expect(calls.range).toEqual([0, 999])
  })

  it('omits warnings entirely when no measured row went stale', async () => {
    const calls = stubSnapshots({ data: [], error: null })
    const { POST } = await import('./route')

    const res = await POST(makeRequest(validBody))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.warnings).toBeUndefined()
    // The empty result is the helper's real "nothing stale" answer, not the
    // absence of a call: the query shape proves the route actually reached
    // retroactiveWarnings for this scenario too.
    expect(calls.table).toBe('portfolio_snapshots')
    expect(calls.select).toBe('*')
    expect(calls.eq).toEqual(['user_id', 'user-1'])
    expect(calls.gte).toEqual(['snapshot_date', validBody.date])
    expect(calls.range).toEqual([0, 999])
  })

  it('still returns 201 when the snapshot read fails', async () => {
    // The transaction is already committed. Failing here would report a write
    // that happened as a write that did not.
    const calls = stubSnapshots({ data: null, error: { message: 'connection reset' } })
    const { POST } = await import('./route')

    const res = await POST(makeRequest({ ...validBody, date: '2026-07-02' }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.warnings).toBeUndefined()
    expect(mockProcessTransaction).toHaveBeenCalledOnce()
    // Proves the query was actually attempted and reached the error branch,
    // not that the helper was never invoked in the first place.
    expect(calls.table).toBe('portfolio_snapshots')
    expect(calls.select).toBe('*')
    expect(calls.eq).toEqual(['user_id', 'user-1'])
    expect(calls.gte).toEqual(['snapshot_date', '2026-07-02'])
  })

  // The 1000-row pagination behaviour itself (the failure mode this stub's
  // shape guards against — see the module docblock on `retroactive-warning.ts`)
  // is pinned directly against `retroactiveWarnings` in
  // `src/lib/api/__tests__/retroactive-warning.test.ts`, not re-derived here.
})
