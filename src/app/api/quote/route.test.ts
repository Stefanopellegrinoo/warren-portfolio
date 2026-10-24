import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { MarketDataError } from '@/lib/market-data/types'

// ── Mock provider ────────────────────────────────────────────────────────────
const mockGetQuote = vi.fn()
let providerFactoryThrows = false
vi.mock('@/lib/market-data', () => ({
  getMarketDataProvider: () => {
    if (providerFactoryThrows) throw new Error('provider misconfigured')
    return {
    getCandles: vi.fn(),
    getQuote: mockGetQuote,
    searchTickers: vi.fn(),
    }
  },
  MarketDataError,
}))

// ── Mock auth ────────────────────────────────────────────────────────────────
const mockRequireUser = vi.fn()
const mockIsAuthFailure = vi.fn()
// Pass-through cache that records key and TTL.
const mockCached = vi.fn(async (_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher())
vi.mock('@/lib/cache', () => ({
  cached: (key: string, ttl: number, fetcher: () => Promise<unknown>) => mockCached(key, ttl, fetcher),
}))

vi.mock('@/lib/api-auth', () => ({
  requireUser: mockRequireUser,
  isAuthFailure: mockIsAuthFailure,
}))

const mockRateLimit = vi.fn()
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  rateLimit: (...a: unknown[]) => mockRateLimit(...a),
}))

function makeRequest(params: Record<string, string>) {
  const url = new URL('http://localhost/api/quote')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url)
}

const fakeQuote = {
  ticker: 'AAPL',
  price: 150.5,
  change: 1.2,
  changePercent: 0.008,
  previousClose: 149.3,
  updatedAt: '2024-01-15T10:00:00Z',
}

describe('GET /api/quote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    providerFactoryThrows = false
    mockRequireUser.mockResolvedValue({ user: { id: 'user-1' }, supabase: {} })
    mockIsAuthFailure.mockReturnValue(false)
    mockRateLimit.mockResolvedValue(true)
  })

  // T5 (odd/tasks/security-hardening.md S5)
  it('returns 429 once the user is over 60 quote calls per 60 s', async () => {
    const { GET } = await import('./route')
    mockRateLimit.mockResolvedValue(false)

    const res = await GET(makeRequest({ ticker: 'AAPL' }))

    expect(mockRateLimit).toHaveBeenCalledWith('rl:quote:user-1', 60, 60)
    expect(res.status).toBe(429)
    expect(mockGetQuote).not.toHaveBeenCalled()
  })

  it('returns 400 for more than 50 distinct tickers and counts a repeated ticker once', async () => {
    const { GET } = await import('./route')
    mockGetQuote.mockResolvedValue(fakeQuote)
    const fifty = Array.from({ length: 50 }, (_, i) => `T${i}`)

    const over = await GET(makeRequest({ tickers: [...fifty, 'T50'].join(',') }))
    expect(over.status).toBe(400)
    expect(mockGetQuote).not.toHaveBeenCalled()

    const atLimit = await GET(makeRequest({ tickers: [...fifty, 't0', 'T1'].join(',') }))
    expect(atLimit.status).toBe(200)
    expect(mockGetQuote).toHaveBeenCalledTimes(50)
  })

  it('caches each ticker for 15 s so several pollers share one Yahoo call', async () => {
    const { GET } = await import('./route')
    mockGetQuote.mockResolvedValue(fakeQuote)

    await GET(makeRequest({ tickers: 'aapl,MSFT' }))

    expect(mockCached.mock.calls.map((c) => c.slice(0, 2))).toEqual([['quote:AAPL', 15], ['quote:MSFT', 15]])
  })

  it('calls provider.getQuote with the requested ticker', async () => {
    const { GET } = await import('./route')
    mockGetQuote.mockResolvedValue(fakeQuote)

    await GET(makeRequest({ ticker: 'AAPL' }))

    expect(mockGetQuote).toHaveBeenCalledWith('AAPL')
  })

  it('returns 200 with the expected shape', async () => {
    const { GET } = await import('./route')
    mockGetQuote.mockResolvedValue(fakeQuote)

    const res = await GET(makeRequest({ ticker: 'AAPL' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    // The route returns an array for backward compat
    expect(data[0].ticker).toBe('AAPL')
    expect(data[0].price).toBe(150.5)
  })

  it('includes the change field in the response', async () => {
    const { GET } = await import('./route')
    mockGetQuote.mockResolvedValue(fakeQuote)

    const res = await GET(makeRequest({ ticker: 'AAPL' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(typeof data[0].change).toBe('number')
    expect(data[0].change).toBe(1.2)
  })

  it('returns change: 0 when provider returns undefined change', async () => {
    const { GET } = await import('./route')
    const quoteWithoutChange = { ...fakeQuote, change: undefined }
    mockGetQuote.mockResolvedValue(quoteWithoutChange)

    const res = await GET(makeRequest({ ticker: 'AAPL' }))
    const data = await res.json()
    expect(data[0].change).toBe(0)
  })

  it('returns a generic 500 JSON when the provider factory throws', async () => {
    const { GET } = await import('./route')
    providerFactoryThrows = true
    const res = await GET(makeRequest({ ticker: 'AAPL' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('No se pudo completar la operación')
  })

  it('returns 400 when no ticker provided', async () => {
    const { GET } = await import('./route')
    const res = await GET(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it('returns 404 when provider throws NOT_FOUND', async () => {
    const { GET } = await import('./route')
    mockGetQuote.mockRejectedValue(new MarketDataError('NOT_FOUND', 'Not found'))

    const res = await GET(makeRequest({ ticker: 'AAPL' }))
    expect(res.status).toBe(404)
  })

  it('returns 503 with a generic message when every ticker is unavailable', async () => {
    const { GET } = await import('./route')
    mockGetQuote.mockRejectedValue(new MarketDataError('PROVIDER_UNAVAILABLE', 'No CCL rate available for BCBA:GGAL (ARS)'))

    const res = await GET(makeRequest({ ticker: 'AAPL' }))
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).not.toMatch(/CCL|ARS|BCBA/)
  })

  it('one unavailable ticker does not blank the batch', async () => {
    const { GET } = await import('./route')
    mockGetQuote.mockImplementation(async (t: string) => {
      if (t === 'BCBA:GGAL') throw new MarketDataError('PROVIDER_UNAVAILABLE', 'No CCL rate available')
      return fakeQuote
    })

    const res = await GET(makeRequest({ tickers: 'AAPL,BCBA:GGAL' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveLength(2)
    expect(data[0]).toMatchObject({ ticker: 'AAPL', price: 150.5 })
    expect(data[1]).toMatchObject({ ticker: 'BCBA:GGAL', price: null, unavailable: true })
    expect(JSON.stringify(data[1])).not.toMatch(/CCL|ARS/)
  })
})
