import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { MarketDataError } from '@/lib/market-data/types'

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
  })

  it('calls provider with no from when days param is absent', async () => {
    const { GET } = await import('./route')
    mockGetCandles.mockResolvedValue([fakeCandle])

    await GET(makeRequest({ ticker: 'AAPL', interval: '1d' }))

    expect(mockGetCandles).toHaveBeenCalledWith('AAPL', '1d', undefined)
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

    const res = await GET(makeRequest({ ticker: 'AAPL', interval: '1d' }))
    expect(res.status).toBe(500)
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
