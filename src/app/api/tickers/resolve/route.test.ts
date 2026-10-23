import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockResolve = vi.fn()
vi.mock('@/lib/ticker-identity', () => ({
  resolveTickerIdentity: (...a: unknown[]) => mockResolve(...a),
}))

const mockRequireUser = vi.fn()
const mockIsAuthFailure = vi.fn()
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
  const url = new URL('http://localhost/api/tickers/resolve')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireUser.mockResolvedValue({ user: { id: 'user-1' }, supabase: {} })
  mockIsAuthFailure.mockReturnValue(false)
  mockRateLimit.mockResolvedValue(true)
})

describe('GET /api/tickers/resolve', () => {
  it('returns the resolution for a ticker', async () => {
    const { GET } = await import('./route')
    mockResolve.mockResolvedValue({
      found: true,
      identity: { ticker: 'UN', yahooSymbol: 'UN', name: 'Corgi UNH 2x Daily ETF', exchange: 'Cboe US', price: 25.0261 },
    })

    const res = await GET(makeRequest({ ticker: 'UN' }))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ found: true, identity: { name: 'Corgi UNH 2x Daily ETF' } })
  })

  it('returns 400 when the ticker param is missing', async () => {
    const { GET } = await import('./route')

    const res = await GET(makeRequest({}))

    expect(res.status).toBe(400)
    expect(mockResolve).not.toHaveBeenCalled()
  })

  it('propagates a not-found resolution as a 200 with found:false', async () => {
    const { GET } = await import('./route')
    mockResolve.mockResolvedValue({ found: false, reason: 'not-found' })

    const res = await GET(makeRequest({ ticker: 'TESLA' }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ found: false, reason: 'not-found' })
  })

  it('returns 503 when resolution throws, so the client never treats it as unverified-but-fine', async () => {
    const { GET } = await import('./route')
    mockResolve.mockRejectedValue(new Error('yahoo down'))

    const res = await GET(makeRequest({ ticker: 'NVDA' }))

    expect(res.status).toBe(503)
  })

  it('refuses unauthenticated callers', async () => {
    const { GET } = await import('./route')
    const denied = new Response('nope', { status: 401 })
    mockRequireUser.mockResolvedValue({ error: denied })
    mockIsAuthFailure.mockReturnValue(true)

    const res = await GET(makeRequest({ ticker: 'NVDA' }))

    expect(res.status).toBe(401)
    expect(mockResolve).not.toHaveBeenCalled()
  })

  // T5 (odd/tasks/security-hardening.md S5)
  it('returns 429 once the user is over 60 resolutions per 60 s', async () => {
    const { GET } = await import('./route')
    mockRateLimit.mockResolvedValue(false)

    const res = await GET(makeRequest({ ticker: 'NVDA' }))

    expect(mockRateLimit).toHaveBeenCalledWith('rl:tickers-resolve:user-1', 60, 60)
    expect(res.status).toBe(429)
    expect(mockResolve).not.toHaveBeenCalled()
  })

  it('returns 400 when the ticker is longer than 64 characters, so it never becomes a cache key', async () => {
    const { GET } = await import('./route')

    const res = await GET(makeRequest({ ticker: 'A'.repeat(65) }))

    expect(res.status).toBe(400)
    expect(mockResolve).not.toHaveBeenCalled()
  })
})
