import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { MarketDataError } from '@/lib/market-data/types'

// ── Mock provider ────────────────────────────────────────────────────────────
const mockGetQuote = vi.fn()
vi.mock('@/lib/market-data', () => ({
  getMarketDataProvider: () => ({
    getCandles: vi.fn(),
    getQuote: mockGetQuote,
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
    mockRequireUser.mockResolvedValue({ user: { id: 'user-1' }, supabase: {} })
    mockIsAuthFailure.mockReturnValue(false)
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
