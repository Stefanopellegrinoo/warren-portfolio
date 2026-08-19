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

beforeEach(() => {
  vi.clearAllMocks()
  mockGetCachedRoute.mockResolvedValue(null)
  mockCacheRoute.mockResolvedValue(undefined)
})

describe('fetchHistoricalQuotes — BCBA normalization', () => {
  it('throws when a BCBA date has no CCL rate instead of returning the ARS price', async () => {
    const { fetchHistoricalQuotes } = await import('../yahoo-finance')
    mockHistorical.mockResolvedValue([
      { date: new Date('2024-01-15T00:00:00Z'), close: 5000 },
      { date: new Date('2024-01-16T00:00:00Z'), close: 5100 },
    ])
    // 2024-01-16 is deliberately missing from the CCL series.
    mockGetHistoricalCCL.mockResolvedValue(new Map([['2024-01-15', 1000]]))

    await expect(
      fetchHistoricalQuotes('BCBA:GGAL', new Date('2024-01-15'), new Date('2024-01-16'))
    ).rejects.toThrow(/CCL/)
  })

  it('converts to USD when every date has a rate', async () => {
    const { fetchHistoricalQuotes } = await import('../yahoo-finance')
    mockHistorical.mockResolvedValue([{ date: new Date('2024-01-15T00:00:00Z'), close: 5000 }])
    mockGetHistoricalCCL.mockResolvedValue(new Map([['2024-01-15', 1000]]))

    const rows = await fetchHistoricalQuotes('BCBA:GGAL', new Date('2024-01-15'), new Date('2024-01-15'))

    expect(rows).toEqual([{ date: '2024-01-15', close: 5 }])
  })

  it('leaves a non-BCBA ticker untouched', async () => {
    const { fetchHistoricalQuotes } = await import('../yahoo-finance')
    mockHistorical.mockResolvedValue([{ date: new Date('2024-01-15T00:00:00Z'), close: 150 }])

    const rows = await fetchHistoricalQuotes('AAPL', new Date('2024-01-15'), new Date('2024-01-15'))

    expect(rows).toEqual([{ date: '2024-01-15', close: 150 }])
    expect(mockGetHistoricalCCL).not.toHaveBeenCalled()
  })
})
