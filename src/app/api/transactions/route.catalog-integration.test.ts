/**
 * POST /api/transactions × the REAL ticker-catalog module.
 *
 * `route.test.ts` mocks `@/lib/ticker-catalog` wholesale, which means the seam
 * that actually breaks in production — the catalog layer talking to Supabase —
 * is the one seam that suite can never exercise. Both Critical findings on this
 * branch lived precisely there:
 *
 *   1. `getCataloguedTicker` throws on ANY Supabase error, including
 *      `relation "ticker_identity" does not exist` (deploy-before-migration).
 *      That call sits outside the route's inner try, so it surfaces as a 500 —
 *      not a 409, and emphatically not a silent "not catalogued" degrade.
 *   2. The catalog WRITE must use `createServiceClient()`. Migration 032 grants
 *      INSERT/UPDATE on `ticker_identity` TO service_role only, so writing with
 *      the request-scoped anon client is denied by RLS and jams the gate shut
 *      for every new ticker.
 *
 * So this file mocks only the collaborators that are genuinely out of scope
 * (auth, the portfolio engine, Redis, Yahoo resolution, the client factory) and
 * drives the real catalog module through a hand-written Supabase stub. The stub
 * records WHICH client instance each call arrived on, so swapping either client
 * back breaks a test instead of shipping quietly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockProcessTransaction = vi.fn()
vi.mock('@/lib/portfolio-engine', () => ({
  processTransaction: (...a: unknown[]) => mockProcessTransaction(...a),
}))

const mockInvalidate = vi.fn()
vi.mock('@/lib/redis', () => ({ invalidateUserCache: (...a: unknown[]) => mockInvalidate(...a) }))

const mockResolve = vi.fn()
vi.mock('@/lib/ticker-identity', () => ({ resolveTickerIdentity: (...a: unknown[]) => mockResolve(...a) }))

const mockRequireUser = vi.fn()
const mockIsAuthFailure = vi.fn()
vi.mock('@/lib/api-auth', () => ({ requireUser: mockRequireUser, isAuthFailure: mockIsAuthFailure }))

// NOTE: `@/lib/ticker-catalog` is deliberately NOT mocked.

// ── Supabase stub ───────────────────────────────────────────────────────────
type CatalogCall =
  | { client: unknown; op: 'read'; ticker: string }
  | { client: unknown; op: 'write'; row: Record<string, unknown>; options: unknown }

/** Every catalog call any stub receives, in order, tagged with its client. */
const catalogCalls: CatalogCall[] = []

/** Mutable per-test: what the stubbed `ticker_identity` table answers with. */
let readResult: { data: unknown; error: { message: string } | null }
let writeResult: { error: { message: string } | null }

/**
 * Implements exactly the two call shapes `ticker-catalog.ts` builds:
 *   `.from('ticker_identity').select(cols).eq('ticker', v).maybeSingle()`
 *   `.from('ticker_identity').upsert(row, { onConflict: 'ticker' })`
 * Anything else throws, so a change in the query shape surfaces here rather
 * than passing against a stub that accepts everything — EXCEPT
 * `portfolio_snapshots`: this suite is scoped to the ticker-catalog seam, not
 * the retroactive-entry warning, and every 201 response now reaches
 * `retroactiveWarnings`. Without this branch that call would throw the same
 * "unexpected table" error, which the helper swallows-and-logs — polluting
 * every test in this file with a stderr line unrelated to what it verifies.
 */
function makeSupabaseStub(label: string) {
  const client: Record<string, unknown> = { __label: label }
  client.from = (table: string) => {
    if (table === 'portfolio_snapshots') {
      // Must match `fetchSnapshotSeries`'s real chain — select/eq/gte/order all
      // return the chain, and the query only resolves on `.range()`. This stub
      // used to resolve off `.order()` directly (the OLD, unpaginated shape);
      // fetchSnapshotSeries then called `.range()` on the result of `.order()`
      // — a Promise, not a query builder — and threw `TypeError: ...range is
      // not a function`. `retroactiveWarnings` swallows that, so every test in
      // this file silently ran through the fail-open catch instead of the real
      // "no snapshots, no warnings" path — passing, but not testing what it
      // claimed to.
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.gte = () => chain
      chain.order = () => chain
      chain.range = () => Promise.resolve({ data: [], error: null })
      return chain
    }
    if (table !== 'ticker_identity') throw new Error(`unexpected table: ${table}`)
    return {
      select: () => ({
        eq: (column: string, value: string) => {
          if (column !== 'ticker') throw new Error(`unexpected filter column: ${column}`)
          return {
            maybeSingle: async () => {
              catalogCalls.push({ client, op: 'read', ticker: value })
              return readResult
            },
          }
        },
      }),
      upsert: async (row: Record<string, unknown>, options: unknown) => {
        catalogCalls.push({ client, op: 'write', row, options })
        return writeResult
      },
    }
  }
  return client
}

// Two distinct instances so a test can tell them apart by identity, not shape.
const userClient = makeSupabaseStub('user-scoped')
const serviceClient = makeSupabaseStub('service-role')

const mockCreateServiceClient = vi.fn(() => serviceClient)
vi.mock('@/lib/supabase-server', () => ({ createServiceClient: () => mockCreateServiceClient() }))

// ── Fixtures ────────────────────────────────────────────────────────────────
function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validBody = {
  date: '2026-04-15',
  ticker: 'PLTR',
  operation: 'COMPRA',
  quantity: 10,
  price: 60,
  assetType: 'CEDEAR',
}

const pltrResolution = {
  found: true as const,
  identity: {
    ticker: 'PLTR',
    yahooSymbol: 'PLTR',
    name: 'Palantir Technologies Inc.',
    exchange: 'NasdaqGS',
    price: 60,
  },
}

const reads = () => catalogCalls.filter((c) => c.op === 'read')
const writes = () => catalogCalls.filter((c) => c.op === 'write')

beforeEach(() => {
  vi.clearAllMocks()
  catalogCalls.length = 0
  readResult = { data: null, error: null }
  writeResult = { error: null }
  mockRequireUser.mockResolvedValue({ user: { id: 'user-1' }, supabase: userClient })
  mockIsAuthFailure.mockReturnValue(false)
  mockProcessTransaction.mockResolvedValue({ id: 'tx-1' })
  mockInvalidate.mockResolvedValue(undefined)
  mockCreateServiceClient.mockReturnValue(serviceClient)
  mockResolve.mockResolvedValue(pltrResolution)
})

describe('POST /api/transactions — real ticker-catalog against a failing Supabase', () => {
  it('500s when the catalog table does not exist yet, and writes no transaction', async () => {
    const { POST } = await import('./route')
    // The deploy-before-migration case: code shipped, migration 032 did not.
    readResult = { data: null, error: { message: 'relation "ticker_identity" does not exist' } }

    const res = await POST(makeRequest(validBody))

    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining('ticker_identity'),
    })
    expect(mockProcessTransaction).not.toHaveBeenCalled()
    expect(writes()).toHaveLength(0)
  })

  it('500s on any other catalog read failure rather than reading an outage as "not catalogued"', async () => {
    const { POST } = await import('./route')
    readResult = { data: null, error: { message: 'connection reset by peer' } }

    const res = await POST(makeRequest(validBody))

    expect(res.status).toBe(500)
    expect(mockProcessTransaction).not.toHaveBeenCalled()
    expect(writes()).toHaveLength(0)
    // Crucially it never even asks Yahoo: a failed read is not a cache miss, so
    // the user is never prompted to confirm an already-confirmed ticker.
    expect(mockResolve).not.toHaveBeenCalled()
  })

  it('500s when RLS denies the catalog write instead of skipping the catalog silently', async () => {
    const { POST } = await import('./route')
    writeResult = {
      error: { message: 'new row violates row-level security policy for table "ticker_identity"' },
    }

    const res = await POST(makeRequest({ ...validBody, confirmTicker: true }))

    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining('row-level security policy'),
    })
    // The catalog must never fall behind the ledger it describes: no catalog
    // row means no transaction either.
    expect(mockProcessTransaction).not.toHaveBeenCalled()
    expect(mockInvalidate).not.toHaveBeenCalled()
  })
})

describe('POST /api/transactions — real ticker-catalog, client split', () => {
  it('reads with the request-scoped client and writes with the service client', async () => {
    const { POST } = await import('./route')

    const res = await POST(makeRequest({ ...validBody, confirmTicker: true }))

    expect(res.status).toBe(201)

    const read = reads()[0]
    const write = writes()[0]
    expect(read).toBeDefined()
    expect(write).toBeDefined()

    // Assert on the INSTANCES, not on call counts: swapping either direction
    // (read on the service client, or write on the user client) fails here.
    expect(read.client).toBe(userClient)
    expect(write.client).toBe(serviceClient)
    expect(write.client).not.toBe(read.client)
    expect(mockCreateServiceClient).toHaveBeenCalledTimes(1)
  })

  it('never touches the service client when the ticker is already catalogued', async () => {
    const { POST } = await import('./route')
    readResult = {
      data: {
        ticker: 'PLTR',
        yahoo_symbol: 'PLTR',
        confirmed_name: 'Palantir Technologies Inc.',
        exchange: 'NasdaqGS',
        last_checked_at: null,
      },
      error: null,
    }

    const res = await POST(makeRequest(validBody))

    expect(res.status).toBe(201)
    expect(writes()).toHaveLength(0)
    expect(mockCreateServiceClient).not.toHaveBeenCalled()
    expect(mockResolve).not.toHaveBeenCalled()
  })
})

describe('POST /api/transactions — real ticker-catalog, happy path', () => {
  it('writes the resolved identity through the real catalog, then books the transaction', async () => {
    const { POST } = await import('./route')

    const res = await POST(makeRequest({ ...validBody, confirmTicker: true }))

    expect(res.status).toBe(201)

    // The row is built by the REAL upsertTickerIdentity, so this asserts the
    // column mapping the database actually receives.
    const write = writes()[0]
    expect(write.row).toEqual({
      ticker: 'PLTR',
      yahoo_symbol: 'PLTR',
      confirmed_name: 'Palantir Technologies Inc.',
      exchange: 'NasdaqGS',
    })
    expect(write.options).toEqual({ onConflict: 'ticker' })

    // Read and write agree on the key, uppercased by the real module.
    expect(reads()[0].ticker).toBe('PLTR')
    expect(mockProcessTransaction).toHaveBeenCalledTimes(1)
    expect(mockInvalidate).toHaveBeenCalledWith('user-1')
  })

  it('catalogues an unresolvable ticker as such so it stops being re-prompted', async () => {
    const { POST } = await import('./route')
    mockResolve.mockResolvedValue({ found: false, reason: 'not-found' })

    const res = await POST(makeRequest({ ...validBody, ticker: 'MYTHING', confirmTicker: true }))

    expect(res.status).toBe(201)
    expect(writes()[0].row).toMatchObject({
      ticker: 'MYTHING',
      yahoo_symbol: 'MYTHING',
      confirmed_name: '(no instrument found on Yahoo)',
      exchange: null,
    })
  })
})
