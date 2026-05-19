import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { MarketDataError } from '@/lib/market-data/types'

// ── Mock provider ─────────────────────────────────────────────────────────────
const mockGetQuote = vi.fn()
vi.mock('@/lib/market-data', () => ({
  getMarketDataProvider: () => ({
    getCandles: vi.fn(),
    getQuote: mockGetQuote,
    searchTickers: vi.fn(),
  }),
  MarketDataError,
}))

// ── Mock auth ─────────────────────────────────────────────────────────────────
const mockRequireUser = vi.fn()
const mockIsAuthFailure = vi.fn()
vi.mock('@/lib/api-auth', () => ({
  requireUser: mockRequireUser,
  isAuthFailure: mockIsAuthFailure,
}))

// ── Supabase mock (injected via requireUser result) ───────────────────────────
const mockFrom = vi.fn()
const mockSupabase = { from: mockFrom }

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeGetRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/watchlist')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url, { method: 'GET' })
}

function makePostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeDeleteRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/watchlist')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url, { method: 'DELETE' })
}

const fakeUser = { id: 'user-1' }
const fakeWatchlistRows = [
  { id: 'id-1', symbol: 'AAPL', added_at: '2026-01-01T00:00:00Z' },
  { id: 'id-2', symbol: 'MSFT', added_at: '2026-01-02T00:00:00Z' },
]
const fakeQuoteAAPL = { ticker: 'AAPL', price: 150, changePercent: 1.5, change: 2.2, previousClose: 148, updatedAt: '2026-01-01T10:00:00Z' }
const fakeQuoteMSFT = { ticker: 'MSFT', price: 400, changePercent: -0.5, change: -2, previousClose: 402, updatedAt: '2026-01-01T10:00:00Z' }

// ── Build chainable Supabase mock ─────────────────────────────────────────────
function buildSelectChain(data: unknown, error: unknown = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error }),
  }
  return chain
}

function buildInsertChain(data: unknown, error: unknown = null) {
  const chain = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockResolvedValue({ data, error }),
  }
  return chain
}

function buildDeleteChain(data: unknown, error: unknown = null) {
  const chain = {
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    // Last .eq() needs to resolve — handled by makeDeleteChain
  }
  return chain
}

describe('GET /api/watchlist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ user: fakeUser, supabase: mockSupabase })
    mockIsAuthFailure.mockReturnValue(false)
  })

  it('returns 401 when not authenticated', async () => {
    mockRequireUser.mockResolvedValue({ error: new Response(null, { status: 401 }) })
    mockIsAuthFailure.mockReturnValue(true)

    const { GET } = await import('./route')
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(401)
  })

  it('returns enriched watchlist with price and changePercent', async () => {
    const selectChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: fakeWatchlistRows, error: null }),
    }
    mockFrom.mockReturnValue(selectChain)
    mockGetQuote
      .mockResolvedValueOnce(fakeQuoteAAPL)
      .mockResolvedValueOnce(fakeQuoteMSFT)

    const { GET } = await import('./route')
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.watchlist).toHaveLength(2)
    expect(body.watchlist[0].symbol).toBe('AAPL')
    expect(body.watchlist[0].price).toBe(150)
    expect(body.watchlist[0].changePercent).toBe(1.5)
    expect(body.watchlist[1].symbol).toBe('MSFT')
    expect(body.watchlist[1].price).toBe(400)
    expect(body.watchlist[1].changePercent).toBe(-0.5)
  })

  it('returns null price/changePercent when quote fetch fails', async () => {
    const selectChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [{ id: 'id-1', symbol: 'AAPL', added_at: '2026-01-01T00:00:00Z' }], error: null }),
    }
    mockFrom.mockReturnValue(selectChain)
    mockGetQuote.mockRejectedValue(new MarketDataError('NOT_FOUND', 'Not found'))

    const { GET } = await import('./route')
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.watchlist[0].price).toBeNull()
    expect(body.watchlist[0].changePercent).toBeNull()
  })
})

describe('POST /api/watchlist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ user: fakeUser, supabase: mockSupabase })
    mockIsAuthFailure.mockReturnValue(false)
  })

  it('returns 401 when not authenticated', async () => {
    mockRequireUser.mockResolvedValue({ error: new Response(null, { status: 401 }) })
    mockIsAuthFailure.mockReturnValue(true)

    const { POST } = await import('./route')
    const res = await POST(makePostRequest({ symbol: 'TSLA' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when symbol is missing', async () => {
    const { POST } = await import('./route')
    const res = await POST(makePostRequest({}))
    expect(res.status).toBe(400)
  })

  it('returns 201 when symbol is added successfully', async () => {
    const insertChain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({
        data: [{ id: 'new-id', symbol: 'TSLA', user_id: 'user-1', added_at: '2026-01-01T00:00:00Z' }],
        error: null,
      }),
    }
    mockFrom.mockReturnValue(insertChain)

    const { POST } = await import('./route')
    const res = await POST(makePostRequest({ symbol: 'TSLA' }))
    expect(res.status).toBe(201)
  })

  it('returns 409 when symbol already exists (unique constraint violation)', async () => {
    const insertChain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({
        data: null,
        error: { code: '23505', message: 'duplicate key value' },
      }),
    }
    mockFrom.mockReturnValue(insertChain)

    const { POST } = await import('./route')
    const res = await POST(makePostRequest({ symbol: 'AAPL' }))
    expect(res.status).toBe(409)

    const body = await res.json()
    expect(body.error).toBe('Already in watchlist')
  })
})

describe('DELETE /api/watchlist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ user: fakeUser, supabase: mockSupabase })
    mockIsAuthFailure.mockReturnValue(false)
  })

  it('returns 401 when not authenticated', async () => {
    mockRequireUser.mockResolvedValue({ error: new Response(null, { status: 401 }) })
    mockIsAuthFailure.mockReturnValue(true)

    const { DELETE } = await import('./route')
    const res = await DELETE(makeDeleteRequest({ symbol: 'AAPL' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when symbol param is missing', async () => {
    const { DELETE } = await import('./route')
    const res = await DELETE(makeDeleteRequest())
    expect(res.status).toBe(400)
  })

  it('returns 200 when symbol is deleted successfully', async () => {
    // Chainable mock: .delete().eq(user_id).eq(symbol).select('id') → resolves
    const eqSpy = vi.fn()
    const deleteChain = {
      delete: vi.fn().mockReturnThis(),
      eq: eqSpy,
    }
    // First .eq() returns chain with eq + select; second .eq() returns chain with select
    eqSpy.mockReturnValueOnce({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: [{ id: 'id-1' }], error: null }),
      }),
    })
    mockFrom.mockReturnValue(deleteChain)

    const { DELETE } = await import('./route')
    const res = await DELETE(makeDeleteRequest({ symbol: 'AAPL' }))
    expect(res.status).toBe(200)
  })

  it('returns 404 when symbol is not in watchlist', async () => {
    const eqSpy = vi.fn()
    const deleteChain = {
      delete: vi.fn().mockReturnThis(),
      eq: eqSpy,
    }
    eqSpy.mockReturnValueOnce({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    })
    mockFrom.mockReturnValue(deleteChain)

    const { DELETE } = await import('./route')
    const res = await DELETE(makeDeleteRequest({ symbol: 'NOTEXIST' }))
    expect(res.status).toBe(404)
  })
})
