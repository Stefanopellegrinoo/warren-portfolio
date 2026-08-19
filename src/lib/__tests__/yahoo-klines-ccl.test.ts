/**
 * fetchKlines — the third ARS→USD site.
 *
 * The branch closed the `if (rate)`-with-no-else fall-through in
 * `fetchHistoricalQuotes` (yahoo-finance.ts) and in the market-data Yahoo
 * provider, but `fetchKlines` kept it: a `BCBA:` day with no CCL rate left the
 * whole OHLC row in pesos and returned it as USD, roughly 1000x high. Its
 * consumer is the signals worker, so the phantom candle turned into a phantom
 * breakout on a real strategy.
 *
 * The refusal must also survive the enclosing catch, which otherwise swallows
 * every error into an empty array — hence the `No historical CCL rate` re-throw
 * guard, shared verbatim with `fetchHistoricalQuotes`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockHistorical = vi.fn()
const mockGetHistoricalCCL = vi.fn()
const mockGetCachedRoute = vi.fn()
const mockCacheRoute = vi.fn()

vi.mock('../redis', () => ({
  getRedis: () => null,
  isRedisReady: () => false,
  ensureRedisConnected: async () => false,
  getCachedRoute: (...a: unknown[]) => mockGetCachedRoute(...a),
  cacheRoute: (...a: unknown[]) => mockCacheRoute(...a),
}))
vi.mock('../currency', () => ({
  getCCLRate: async () => 1000,
  getHistoricalCCL: (...a: unknown[]) => mockGetHistoricalCCL(...a),
}))
vi.mock('yahoo-finance2', () => ({
  default: class {
    suppressNotices() {}
    historical(...a: unknown[]) { return mockHistorical(...a) }
  },
}))

function candle(dateStr: string) {
  return {
    date: new Date(`${dateStr}T00:00:00Z`),
    open: 5000,
    high: 5200,
    low: 4900,
    close: 5100,
    volume: 1234,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetCachedRoute.mockResolvedValue(null)
  mockCacheRoute.mockResolvedValue(undefined)
})

describe('fetchKlines — BCBA normalization', () => {
  it('throws when a BCBA day has no CCL rate instead of returning the ARS candle as USD', async () => {
    const { fetchKlines } = await import('../yahoo-finance')
    mockHistorical.mockResolvedValue([candle('2024-01-15'), candle('2024-01-16')])
    // 2024-01-16 is deliberately missing from the CCL series.
    mockGetHistoricalCCL.mockResolvedValue(new Map([['2024-01-15', 1000]]))

    await expect(
      fetchKlines('BCBA:GGAL', '1d', new Date('2024-01-15'), new Date('2024-01-16'))
    ).rejects.toThrow(/No historical CCL rate/)
  })

  it('never caches a series it refused to normalise', async () => {
    const { fetchKlines } = await import('../yahoo-finance')
    mockHistorical.mockResolvedValue([candle('2024-01-15')])
    mockGetHistoricalCCL.mockResolvedValue(new Map())

    await expect(
      fetchKlines('BCBA:GGAL', '1d', new Date('2024-01-15'), new Date('2024-01-15'))
    ).rejects.toThrow(/No historical CCL rate/)
    // A cached ARS candle outlives the outage that produced it by 24h.
    expect(mockCacheRoute).not.toHaveBeenCalled()
  })

  it('lets the refusal escape the catch that swallows every other error into []', async () => {
    const { fetchKlines } = await import('../yahoo-finance')
    mockHistorical.mockResolvedValue([candle('2024-01-15')])
    mockGetHistoricalCCL.mockResolvedValue(new Map())

    // Same guard as fetchHistoricalQuotes: without the re-throw the enclosing
    // catch returns [], and "no candles" is exactly the silence the throw exists
    // to break — the caller cannot tell a refusal from an empty history.
    const result = await fetchKlines(
      'BCBA:GGAL', '1d', new Date('2024-01-15'), new Date('2024-01-15')
    ).catch((err: Error) => err)

    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toMatch(/refusing to return an ARS candle as USD/)
  })

  it('still swallows an unrelated transport failure into an empty series', async () => {
    const { fetchKlines } = await import('../yahoo-finance')
    mockHistorical.mockRejectedValue(new Error('socket hang up'))

    // The guard must be narrow: only the CCL refusal escapes. Everything else
    // keeps degrading to [], which is what the signals worker expects.
    await expect(
      fetchKlines('BCBA:GGAL', '1d', new Date('2024-01-15'), new Date('2024-01-15'))
    ).resolves.toEqual([])
  })

  it('divides every OHLC leg by the day rate when the rate exists', async () => {
    const { fetchKlines } = await import('../yahoo-finance')
    mockHistorical.mockResolvedValue([candle('2024-01-15')])
    mockGetHistoricalCCL.mockResolvedValue(new Map([['2024-01-15', 1000]]))

    const rows = await fetchKlines('BCBA:GGAL', '1d', new Date('2024-01-15'), new Date('2024-01-15'))

    expect(rows).toEqual([
      { date: '2024-01-15', open: 5, high: 5.2, low: 4.9, close: 5.1, volume: 1234 },
    ])
  })

  it('leaves a non-BCBA ticker untouched and never asks for a CCL series', async () => {
    const { fetchKlines } = await import('../yahoo-finance')
    mockHistorical.mockResolvedValue([candle('2024-01-15')])

    const rows = await fetchKlines('AAPL', '1d', new Date('2024-01-15'), new Date('2024-01-15'))

    expect(rows).toEqual([
      { date: '2024-01-15', open: 5000, high: 5200, low: 4900, close: 5100, volume: 1234 },
    ])
    expect(mockGetHistoricalCCL).not.toHaveBeenCalled()
  })
})
