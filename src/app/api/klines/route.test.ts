import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { MarketDataError } from '@/lib/market-data/types'
import { GENERIC_ERROR } from '@/lib/api/errors'

// ── Mock provider ────────────────────────────────────────────────────────────
const mockGetCandles = vi.fn()
vi.mock('@/lib/market-data', () => ({
  getMarketDataProvider: () => ({
    getCandles: mockGetCandles,
    getQuote: vi.fn(),
    searchTickers: vi.fn(),
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

// ── Mock cache: pass-through that records key and TTL ────────────────────────
const mockCached = vi.fn(async (_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher())
vi.mock('@/lib/cache', () => ({
  cached: (key: string, ttl: number, fetcher: () => Promise<unknown>) => mockCached(key, ttl, fetcher),
}))

const mockRateLimit = vi.fn()
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  rateLimit: (...a: unknown[]) => mockRateLimit(...a),
}))

function makeRequest(params: Record<string, string>) {
  const url = new URL('http://localhost/api/klines')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url)
}

const fakeCandle = { time: '2024-01-15', open: 150, high: 155, low: 148, close: 152, volume: 1000000 }

describe('GET /api/klines', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ user: { id: 'user-1' }, supabase: {} })
    mockIsAuthFailure.mockReturnValue(false)
    mockRateLimit.mockResolvedValue(true)
  })

  // T13 (odd/tasks/security-hardening.md S13)
  it('returns 429 once the user is over 60 klines calls per 60 s', async () => {
    const { GET } = await import('./route')
    mockRateLimit.mockResolvedValue(false)

    const res = await GET(makeRequest({ ticker: 'AAPL', interval: '1d' }))

    expect(mockRateLimit).toHaveBeenCalledWith('rl:klines:user-1', 60, 60)
    expect(res.status).toBe(429)
    expect(mockGetCandles).not.toHaveBeenCalled()
  })

  function daysBack(from: Date): number {
    return Math.round((Date.now() - from.getTime()) / 86_400_000)
  }

  it('bounds 1d to ten years when days param is absent', async () => {
    const { GET } = await import('./route')
    mockGetCandles.mockResolvedValue([fakeCandle])

    await GET(makeRequest({ ticker: 'AAPL', interval: '1d' }))

    expect(mockGetCandles).toHaveBeenCalledWith('AAPL', '1d', expect.any(Date))
    expect(daysBack(mockGetCandles.mock.calls[0][2])).toBe(3650)
  })

  it('bounds 15m to the 59 days Yahoo serves intraday', async () => {
    const { GET } = await import('./route')
    mockGetCandles.mockResolvedValue([fakeCandle])

    const res = await GET(makeRequest({ ticker: 'AAPL', interval: '15m' }))

    expect(res.status).toBe(200)
    expect(mockGetCandles).toHaveBeenCalledWith('AAPL', '15m', expect.any(Date))
    expect(daysBack(mockGetCandles.mock.calls[0][2])).toBe(59)
  })

  it('bounds 1h to 729 days', async () => {
    const { GET } = await import('./route')
    mockGetCandles.mockResolvedValue([fakeCandle])

    await GET(makeRequest({ ticker: 'AAPL', interval: '1h' }))

    expect(daysBack(mockGetCandles.mock.calls[0][2])).toBe(729)
  })

  it('keeps full history for 1w', async () => {
    const { GET } = await import('./route')
    mockGetCandles.mockResolvedValue([fakeCandle])

    await GET(makeRequest({ ticker: 'AAPL', interval: '1w' }))

    expect(mockGetCandles).toHaveBeenCalledWith('AAPL', '1w', undefined)
  })

  it('rejects an interval the provider cannot serve with 400', async () => {
    const { GET } = await import('./route')

    const res = await GET(makeRequest({ ticker: 'AAPL', interval: '4h' }))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Ese intervalo del gráfico no está disponible' })
    expect(mockGetCandles).not.toHaveBeenCalled()
  })

  it('caches every interval for 30 s, keyed by ticker, interval and days', async () => {
    const { GET } = await import('./route')
    mockGetCandles.mockResolvedValue([fakeCandle])

    await GET(makeRequest({ ticker: 'AAPL', interval: '15m' }))
    await GET(makeRequest({ ticker: 'aapl', interval: '1d', days: '90' }))

    expect(mockCached.mock.calls[0].slice(0, 2)).toEqual(['klines:AAPL:15m:59', 30])
    expect(mockCached.mock.calls[1].slice(0, 2)).toEqual(['klines:AAPL:1d:90', 30])
  })

  it('calls provider with from date when days=90 is provided', async () => {
    const { GET } = await import('./route')
    mockGetCandles.mockResolvedValue([fakeCandle])

    const before = Date.now()
    await GET(makeRequest({ ticker: 'AAPL', interval: '1d', days: '90' }))
    const after = Date.now()

    expect(mockGetCandles).toHaveBeenCalledWith('AAPL', '1d', expect.any(Date))
    const callArgs = mockGetCandles.mock.calls[0]
    const fromDate: Date = callArgs[2]
    const expectedMs = 90 * 24 * 60 * 60 * 1000
    expect(before - fromDate.getTime()).toBeGreaterThanOrEqual(expectedMs - 1000)
    expect(after - fromDate.getTime()).toBeLessThanOrEqual(expectedMs + 1000)
  })

  it('returns 200 with candle data on success', async () => {
    const { GET } = await import('./route')
    mockGetCandles.mockResolvedValue([fakeCandle])

    const res = await GET(makeRequest({ ticker: 'AAPL', interval: '1d' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0].time).toBe('2024-01-15')
  })

  it('returns 404 when provider throws NOT_FOUND', async () => {
    const { GET } = await import('./route')
    mockGetCandles.mockRejectedValue(new MarketDataError('NOT_FOUND', 'Ticker not found'))

    const res = await GET(makeRequest({ ticker: 'INVALID', interval: '1d' }))
    expect(res.status).toBe(404)
  })

  it('returns 500 when provider throws PROVIDER_UNAVAILABLE', async () => {
    const { GET } = await import('./route')
    mockGetCandles.mockRejectedValue(new MarketDataError('PROVIDER_UNAVAILABLE', 'Yahoo down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await GET(makeRequest({ ticker: 'AAPL', interval: '1d' }))
    expect(res.status).toBe(500)
    // S6: the provider's text is logged, never echoed.
    expect(await res.json()).toEqual({ error: GENERIC_ERROR })
  })

  it('returns 429 when provider throws RATE_LIMITED', async () => {
    const { GET } = await import('./route')
    mockGetCandles.mockRejectedValue(new MarketDataError('RATE_LIMITED', 'Rate limited'))

    const res = await GET(makeRequest({ ticker: 'AAPL', interval: '1d' }))
    expect(res.status).toBe(429)
  })

  it('returns 400 when ticker is missing', async () => {
    const { GET } = await import('./route')
    const res = await GET(makeRequest({ interval: '1d' }))
    expect(res.status).toBe(400)
  })
})
