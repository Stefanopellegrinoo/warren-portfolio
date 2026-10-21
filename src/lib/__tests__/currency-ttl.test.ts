import { describe, it, expect, vi, beforeEach } from 'vitest'

const redis = {
  get: vi.fn(async () => null as string | null),
  setex: vi.fn(async (_k: string, _ttl: number, _v: string) => 'OK'),
  set: vi.fn(async () => 'OK'),
}
vi.mock('../redis', () => ({ getRedis: () => redis, isRedisReady: () => true }))
vi.mock('../yahoo-finance', () => ({
  fetchRawQuotes: vi.fn(async () => new Map([
    ['GGAL', { price: 50 }],
    ['BCBA:GGAL', { price: 5000 }],
  ])),
}))
vi.mock('../historical-prices', () => ({ fetchDailyBars: vi.fn() }))

beforeEach(() => vi.clearAllMocks())

describe('getCCLRate Redis writes', () => {
  it('stores the last-known rate with a TTL (Redis is noeviction, every key must expire)', async () => {
    const { getCCLRate } = await import('../currency')
    expect(await getCCLRate()).toBe(1000)
    expect(redis.set).not.toHaveBeenCalled()
    const keys = redis.setex.mock.calls.map(c => c[0])
    expect(keys).toContain('currency:ccl:lkp')
    for (const c of redis.setex.mock.calls) expect(c[1]).toBeGreaterThan(0)
  })

  it('returns null, not an invented rate, when Yahoo and Redis have nothing', async () => {
    const { fetchRawQuotes } = await import('../yahoo-finance')
    vi.mocked(fetchRawQuotes).mockRejectedValueOnce(new Error('down'))
    redis.get.mockResolvedValue(null)
    const { getCCLRate } = await import('../currency')
    expect(await getCCLRate()).toBeNull()
  })
})
