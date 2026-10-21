import { describe, it, expect, vi, beforeEach } from 'vitest'

const redis = { get: vi.fn(), ttl: vi.fn(), setex: vi.fn() }
let ready = true
vi.mock('../redis', () => ({ getRedis: () => redis, isRedisReady: () => ready }))
const fetchRawQuotes = vi.fn()
vi.mock('../yahoo-finance', () => ({ fetchRawQuotes: (...a: unknown[]) => fetchRawQuotes(...a) }))
vi.mock('../historical-prices', () => ({ fetchDailyBars: vi.fn() }))

const { getCCLRateInfo } = await import('../currency')

beforeEach(() => {
  redis.get.mockReset()
  redis.ttl.mockReset()
  redis.setex.mockReset()
  fetchRawQuotes.mockReset()
  ready = true
})

describe('getCCLRateInfo', () => {
  it('short cache: age comes from the key TTL', async () => {
    redis.get.mockResolvedValueOnce('1600')
    redis.ttl.mockResolvedValueOnce(3600 - 600) // cached 10 min ago
    const r = (await getCCLRateInfo())!
    expect(r.source).toBe('cache')
    expect(r.rate).toBe(1600)
    expect(Date.now() - Date.parse(r.asOf)).toBeGreaterThan(9 * 60_000)
    expect(Date.now() - Date.parse(r.asOf)).toBeLessThan(11 * 60_000)
  })

  it('live fetch is stamped now', async () => {
    redis.get.mockResolvedValueOnce(null)
    fetchRawQuotes.mockResolvedValueOnce(new Map([['GGAL', { price: 50 }], ['BCBA:GGAL', { price: 8000 }]]))
    const r = (await getCCLRateInfo())!
    expect(r).toMatchObject({ rate: 1600, source: 'live' })
    expect(Date.now() - Date.parse(r.asOf)).toBeLessThan(5_000)
  })

  it('last-known rate reports its real age (up to 30 days)', async () => {
    redis.get.mockResolvedValueOnce(null).mockResolvedValueOnce('1500')
    redis.ttl.mockResolvedValueOnce(30 * 86400 - 3 * 86400) // fetched 3 days ago
    fetchRawQuotes.mockRejectedValueOnce(new Error('down'))
    const r = (await getCCLRateInfo())!
    expect(r.source).toBe('lkp')
    expect(Date.now() - Date.parse(r.asOf)).toBeGreaterThan(2.9 * 86400_000)
  })

  it('nothing available: null, never an invented rate', async () => {
    ready = false
    fetchRawQuotes.mockRejectedValueOnce(new Error('down'))
    expect(await getCCLRateInfo()).toBeNull()
  })

  it('a ttl() failure never turns a cached hit into a throw', async () => {
    redis.get.mockResolvedValueOnce('1600')
    redis.ttl.mockRejectedValueOnce(new Error('redis timeout'))
    const r = (await getCCLRateInfo())!
    expect(r).toMatchObject({ rate: 1600, source: 'cache' })
  })
})
