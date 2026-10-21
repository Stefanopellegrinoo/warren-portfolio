/**
 * No CCL, no ARS->USD conversion: BCBA quotes must be dropped (never priced
 * with an invented rate), USD quotes untouched, and the worker path alerts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuote = vi.fn()
const mockGetCCLRate = vi.fn()
const mockAlert = vi.fn(async () => {})
const redis = { setex: vi.fn(async () => 'OK'), mget: vi.fn(async () => [] as (string | null)[]) }

vi.mock('../redis', () => ({
  getRedis: () => redis,
  isRedisReady: () => true,
  ensureRedisConnected: async () => true,
  getCachedRoute: vi.fn(),
  cacheRoute: vi.fn(),
}))
vi.mock('../currency', () => ({
  getCCLRate: (...a: unknown[]) => mockGetCCLRate(...a),
  getHistoricalCCL: vi.fn(),
}))
vi.mock('../job-health', () => ({ alertJobFailure: (...a: unknown[]) => (mockAlert as any)(...a) }))
vi.mock('yahoo-finance2', () => ({
  default: class {
    suppressNotices() {}
    quote(...a: unknown[]) { return mockQuote(...a) }
  },
}))

const raw = (symbol: string, price: number) => ({ symbol, regularMarketPrice: price, regularMarketChange: 1 })

beforeEach(() => {
  vi.clearAllMocks()
  mockGetCCLRate.mockResolvedValue(null)
})

describe('fetchQuotesFromYahoo without a CCL rate', () => {
  it('drops BCBA quotes, keeps USD ones and alerts', async () => {
    mockQuote.mockResolvedValue([raw('AAPL', 200), raw('GGAL.BA', 8000)])
    const { fetchQuotesFromYahoo } = await import('../yahoo-finance')
    const out = await fetchQuotesFromYahoo(['AAPL', 'BCBA:GGAL'])
    expect([...out.keys()]).toEqual(['AAPL'])
    expect(out.get('AAPL')!.price).toBe(200)
    expect(mockAlert).toHaveBeenCalledWith('price', 'ccl-unavailable', expect.any(Error))
  })

  it('converts when a real rate exists', async () => {
    mockGetCCLRate.mockResolvedValue(1600)
    mockQuote.mockResolvedValue([raw('GGAL.BA', 8000)])
    const { fetchQuotesFromYahoo } = await import('../yahoo-finance')
    const out = await fetchQuotesFromYahoo(['BCBA:GGAL'])
    expect(out.get('BCBA:GGAL')!.price).toBe(5)
    expect(mockAlert).not.toHaveBeenCalled()
  })
})

describe('fetchQuotesWithFallback without a CCL rate', () => {
  it('neither returns nor caches BCBA prices; USD ones still cache', async () => {
    mockQuote.mockResolvedValue([
      { regularMarketPrice: 200, regularMarketChange: 1, regularMarketChangePercent: 1 },
      { regularMarketPrice: 8000, regularMarketChange: 10, regularMarketChangePercent: 1 },
    ])
    const { fetchQuotesWithFallback } = await import('../yahoo-finance')
    const out = await fetchQuotesWithFallback(['MSFT', 'BCBA:YPFD'])
    expect(out.has('BCBA:YPFD')).toBe(false)
    expect(out.get('MSFT')!.price).toBe(200)
    const keys = redis.setex.mock.calls.map(c => (c as unknown[])[0])
    expect(keys).toEqual(['price:MSFT'])
  })
})

describe('last-good LKP during a CCL outage', () => {
  it('serves the cached BCBA price (stale updatedAt kept) without calling Yahoo', async () => {
    const lkp = { ticker: 'BCBA:LKPTEST', price: 5, change: 0, changePercent: 0, previousClose: 5, updatedAt: '2026-10-10T15:00:00Z' }
    redis.mget.mockResolvedValueOnce([JSON.stringify(lkp)])
    const { fetchQuotesWithFallback } = await import('../yahoo-finance')
    const out = await fetchQuotesWithFallback(['BCBA:LKPTEST'])
    expect(out.get('BCBA:LKPTEST')).toEqual(lkp)
    expect(mockQuote).not.toHaveBeenCalled()
  })
})
