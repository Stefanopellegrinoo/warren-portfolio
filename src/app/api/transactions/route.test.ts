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

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireUser.mockResolvedValue({ user: { id: 'user-1' }, supabase: userClient })
  mockIsAuthFailure.mockReturnValue(false)
  mockProcessTransaction.mockResolvedValue({ id: 'tx-1' })
  mockInvalidate.mockResolvedValue(undefined)
  mockUpsertIdentity.mockResolvedValue(undefined)
  mockCreateServiceClient.mockReturnValue(serviceClient)
  // The route answers from the write alone: any table read is a regression.
  ;(userClient as Record<string, unknown>).from = vi.fn(() => { throw new Error('unexpected table read') })
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

// ── Late loads (S2: the history derives from the ledger and rewrites itself) ──

describe('POST /api/transactions — late load', () => {
  beforeEach(() => {
    mockGetCatalogued.mockResolvedValue({ ticker: 'UN', yahoo_symbol: 'UN' })
  })

  it('answers 201 with the created row only: no warnings, no snapshot read', async () => {
    const { POST } = await import('./route')

    const res = await POST(makeRequest({ ...validBody, date: '2026-07-02' }))

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 'tx-1' })
    expect((userClient as Record<string, unknown>).from).not.toHaveBeenCalled()
    expect(mockInvalidate).toHaveBeenCalledWith('user-1')
  })
})

describe('POST /api/transactions — the core refuses a sale of more than held (T5.1)', () => {
  it('answers 400 with the Spanish reason, not the old 500', async () => {
    const { POST } = await import('./route')
    const { OversellError } = await import('@/lib/ledger-write')
    mockGetCatalogued.mockResolvedValue({ ticker: 'UN' })
    mockProcessTransaction.mockRejectedValue(new OversellError({ kind: 'oversell', ticker: 'UN', date: '2026-04-15', requested: 2000, held: 1769 }))

    const res = await POST(makeRequest({ ...validBody, operation: 'VENTA', quantity: 2000 }))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('No podés vender 2000 UN el 2026-04-15: a esa fecha tenías 1769.')
    expect(mockInvalidate).not.toHaveBeenCalled()
  })
})

describe('POST /api/transactions — 500s are generic, domain errors keep their text (S6)', () => {
  beforeEach(() => {
    mockGetCatalogued.mockResolvedValue({ ticker: 'UN' })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('a database failure answers the generic message, never its text', async () => {
    const { POST } = await import('./route')
    const { normalizeError } = await import('@/lib/errors')
    const { GENERIC_ERROR } = await import('@/lib/api/errors')
    mockProcessTransaction.mockRejectedValue(normalizeError({ code: '42P01', message: 'relation "transactions" does not exist' }))

    const res = await POST(makeRequest(validBody))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: GENERIC_ERROR })
  })

  it('a RAISE EXCEPTION from process_transaction_atomic (P0001) keeps its message and its 500', async () => {
    const { POST } = await import('./route')
    const { normalizeError } = await import('@/lib/errors')
    const message = 'Transaction failed: Insufficient position: cannot sell 2000 UN (SQLSTATE: P0001)'
    mockProcessTransaction.mockRejectedValue(normalizeError({ code: 'P0001', message }))

    const res = await POST(makeRequest({ ...validBody, operation: 'VENTA', quantity: 2000 }))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: message })
  })

  it('the import-in-progress guard keeps its message and its 500', async () => {
    const { POST } = await import('./route')
    const message = 'Hay una importación masiva en curso para este usuario. Por favor, espere a que finalice para realizar cambios manuales.'
    mockProcessTransaction.mockRejectedValue(new Error(message))

    const res = await POST(makeRequest(validBody))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: message })
  })
})
