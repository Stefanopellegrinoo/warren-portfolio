/**
 * getHistoricalCCL × a stubbed Yahoo.
 *
 * The bootstrap used to fetch its local leg through `fetchHistoricalQuotes('BCBA:GGAL')`,
 * which normalises BCBA prices by calling getHistoricalCCL — an endless cycle that hung
 * every caller. It now fetches both legs RAW with fetchDailyBars, so the formula
 * CCL = (local ARS × 10) / adr USD gets the inputs it assumes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const yahooCalls: string[] = []
let yahooDown = false

const ADR_CLOSE = 50      // GGAL in USD
const LOCAL_CLOSE = 5000  // GGAL.BA in ARS
const THE_DATE = '2024-01-15'

const redisGet = vi.fn(async (_key: string): Promise<string | null> => null)
const redisSetex = vi.fn(async (_key: string, _ttl: number, _value: string) => 'OK')

vi.mock('../redis', () => ({
  getRedis: () => ({ get: redisGet, setex: redisSetex, set: vi.fn() }),
  isRedisReady: () => true,
  ensureRedisConnected: async () => false,
  getCachedRoute: async () => null,
  cacheRoute: async () => undefined,
}))

vi.mock('yahoo-finance2', () => {
  class FakeYahoo {
    suppressNotices() {}
    async historical(symbol: string) {
      yahooCalls.push(symbol)
      if (yahooDown) throw new Error('network unreachable')
      return [{ date: new Date(`${THE_DATE}T00:00:00Z`), close: symbol === 'GGAL.BA' ? LOCAL_CLOSE : ADR_CLOSE }]
    }
  }
  return { default: FakeYahoo }
})

const START = new Date('2024-01-01')
const END = new Date('2024-01-15')

beforeEach(async () => {
  // Warm the historical-prices Yahoo singleton first: the two legs run through
  // Promise.all, and two concurrent `await import()` race on the module mock —
  // one leg would otherwise reach the real library and the network.
  const { fetchDailyBars } = await import('../historical-prices')
  await fetchDailyBars('WARM', START, END)
  yahooCalls.length = 0
  yahooDown = false
  vi.clearAllMocks()
  redisGet.mockResolvedValue(null)
})

describe('getHistoricalCCL', () => {
  it('computes CCL from the raw ARS local leg, fetching each leg once', async () => {
    const { getHistoricalCCL } = await import('../currency')

    const rates = await getHistoricalCCL(START, END)

    expect(rates.get(THE_DATE)).toBe((LOCAL_CLOSE * 10) / ADR_CLOSE) // 1000
    expect(yahooCalls.filter((s) => s === 'GGAL.BA')).toHaveLength(1) // no re-entry
  })

  it('caches a non-empty result', async () => {
    const { getHistoricalCCL } = await import('../currency')

    await getHistoricalCCL(START, END)

    const cachedKeys = redisSetex.mock.calls.map(([key]) => key)
    expect(cachedKeys.filter((k) => k.startsWith('currency:h-ccl:'))).toHaveLength(1)
  })

  it('returns an empty Map and caches nothing when Yahoo is down', async () => {
    yahooDown = true
    const { getHistoricalCCL } = await import('../currency')

    const rates = await getHistoricalCCL(START, END)

    expect(rates.size).toBe(0)
    expect(redisSetex).not.toHaveBeenCalled()
  })
})
