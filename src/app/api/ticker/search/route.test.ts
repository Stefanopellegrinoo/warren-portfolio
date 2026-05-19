import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { MarketDataError } from '@/lib/market-data/types'

// ── Mock provider ────────────────────────────────────────────────────────────
const mockSearchTickers = vi.fn()
vi.mock('@/lib/market-data', () => ({
  getMarketDataProvider: () => ({
    getCandles: vi.fn(),
    getQuote: vi.fn(),
    searchTickers: mockSearchTickers,
  }),
  MarketDataError,
}))

// ── Mock auth ────────────────────────────────────────────────────────────────
const mockRequireUser = vi.fn()
const mockIsAuthFailure = vi.fn()
vi.mock('@/lib/api-auth', () => ({
  requireUser: mockRequireUser,
  isAuthFailure: mockIsAuthFailure,
}))

// ── Mock redis cache helpers ─────────────────────────────────────────────────
const mockGetCachedRoute = vi.fn()
const mockCacheRoute = vi.fn()
vi.mock('@/lib/redis', () => ({
  getCachedRoute: mockGetCachedRoute,
  cacheRoute: mockCacheRoute,
}))

function makeRequest(params: Record<string, string>) {
  const url = new URL('http://localhost/api/ticker/search')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url)
}

const fakeResults = [
  { symbol: 'AAPL', shortname: 'Apple Inc.', quoteType: 'EQUITY', exchange: 'NMS' },
  { symbol: 'AAPD', shortname: 'Direxion ETF', quoteType: 'ETF', exchange: 'PCX' },
]

describe('GET /api/ticker/search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ user: { id: 'user-1' }, supabase: {} })
    mockIsAuthFailure.mockReturnValue(false)
    mockGetCachedRoute.mockResolvedValue(null) // cache miss by default
    mockCacheRoute.mockResolvedValue(undefined)
    mockSearchTickers.mockResolvedValue(fakeResults)
  })

  it('returns 401 when not authenticated', async () => {
    mockRequireUser.mockResolvedValue({ error: new Response(null, { status: 401 }) })
    mockIsAuthFailure.mockReturnValue(true)

    const { GET } = await import('./route')
    const res = await GET(makeRequest({ q: 'app' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when q param is missing', async () => {
    const { GET } = await import('./route')
    const res = await GET(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it('returns 400 when q is shorter than 2 characters', async () => {
    const { GET } = await import('./route')
    const res = await GET(makeRequest({ q: 'a' }))
    expect(res.status).toBe(400)
  })

  it('calls searchTickers and returns results on cache miss', async () => {
    const { GET } = await import('./route')
    const res = await GET(makeRequest({ q: 'app' }))

    expect(res.status).toBe(200)
    expect(mockSearchTickers).toHaveBeenCalledWith('app')
    const data = await res.json()
    expect(data.results).toHaveLength(2)
    expect(data.results[0].symbol).toBe('AAPL')
  })

  it('caches results with key ticker-search:app and TTL 600 on cache miss', async () => {
    const { GET } = await import('./route')
    await GET(makeRequest({ q: 'app' }))

    expect(mockCacheRoute).toHaveBeenCalledWith('ticker-search:app', fakeResults, 600)
  })

  it('returns cached data and does NOT call Yahoo when cache hits', async () => {
    mockGetCachedRoute.mockResolvedValue(fakeResults)

    const { GET } = await import('./route')
    const res = await GET(makeRequest({ q: 'app' }))

    expect(res.status).toBe(200)
    expect(mockSearchTickers).not.toHaveBeenCalled()
    const data = await res.json()
    expect(data.results).toHaveLength(2)
  })

  it('normalizes cache key: APP and app hit the same key', async () => {
    const { GET } = await import('./route')

    // First call with uppercase
    await GET(makeRequest({ q: 'APP' }))
    expect(mockGetCachedRoute).toHaveBeenLastCalledWith('ticker-search:app')

    // Second call with lowercase
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ user: { id: 'user-1' }, supabase: {} })
    mockIsAuthFailure.mockReturnValue(false)
    mockGetCachedRoute.mockResolvedValue(null)
    mockSearchTickers.mockResolvedValue(fakeResults)

    await GET(makeRequest({ q: 'app' }))
    expect(mockGetCachedRoute).toHaveBeenLastCalledWith('ticker-search:app')
  })

  it('returns 500 when provider throws PROVIDER_UNAVAILABLE', async () => {
    mockSearchTickers.mockRejectedValue(
      new MarketDataError('PROVIDER_UNAVAILABLE', 'Yahoo down')
    )
    const { GET } = await import('./route')
    const res = await GET(makeRequest({ q: 'app' }))
    expect(res.status).toBe(500)
  })

  it('returns 429 when provider throws RATE_LIMITED', async () => {
    mockSearchTickers.mockRejectedValue(
      new MarketDataError('RATE_LIMITED', 'Too many requests')
    )
    const { GET } = await import('./route')
    const res = await GET(makeRequest({ q: 'app' }))
    expect(res.status).toBe(429)
  })
})
