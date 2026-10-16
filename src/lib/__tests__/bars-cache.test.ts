import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = new Map<string, string>()
const redisMock = {
  get: vi.fn(async (k: string) => store.get(k) ?? null),
  setex: vi.fn(async (k: string, _ttl: number, v: string) => { store.set(k, v); return 'OK' }),
  set: vi.fn(async (k: string, v: string) => { store.set(k, v); return 'OK' }),
}
let redisUp = true
vi.mock('../redis', () => ({
  ensureRedisConnected: vi.fn(async () => redisUp),
  getRedis: vi.fn(() => (redisUp ? redisMock : null)),
}))

import { getBars, _resetBarsMemory } from '../bars-cache'

const TODAY = '2026-05-15'
const FROM = new Date('2026-01-02')
const chart = (close = 10) => ({
  bars: [{ date: '2026-05-14', close }],
  splits: [{ date: '2026-03-01', numerator: 2, denominator: 1 }],
  splitsKnown: true,
})

beforeEach(() => {
  store.clear()
  redisUp = true
  _resetBarsMemory()
  vi.clearAllMocks()
})

describe('getBars', () => {
  it('fetches once, stores under bars:v1:{symbol} with a 7 day TTL, and reuses it the same day', async () => {
    const fetchChart = vi.fn(async () => chart())
    const first = await getBars(['AAA'], FROM, { fetchChart, today: TODAY })
    const again = await getBars(['AAA'], FROM, { fetchChart, today: TODAY })

    expect(fetchChart).toHaveBeenCalledTimes(1)
    expect(redisMock.setex).toHaveBeenCalledWith('bars:v1:AAA', 7 * 86400, expect.any(String))
    expect(first.get('AAA')).toMatchObject({ degraded: false, missing: false, splitsKnown: true })
    expect(again.get('AAA')!.bars).toEqual([{ date: '2026-05-14', close: 10 }])
    expect(again.get('AAA')!.splits).toEqual([{ date: '2026-03-01', numerator: 2, denominator: 1 }])
  })

  it('refetches on a new day', async () => {
    const fetchChart = vi.fn(async () => chart())
    await getBars(['AAA'], FROM, { fetchChart, today: TODAY })
    await getBars(['AAA'], FROM, { fetchChart, today: '2026-05-16' })
    expect(fetchChart).toHaveBeenCalledTimes(2)
  })

  it('refetches when the entry starts later than the requested window', async () => {
    const fetchChart = vi.fn(async () => chart())
    await getBars(['AAA'], new Date('2026-03-01'), { fetchChart, today: TODAY })
    await getBars(['AAA'], FROM, { fetchChart, today: TODAY })
    expect(fetchChart).toHaveBeenCalledTimes(2)
  })

  it('S8.1: Yahoo fails with a stale entry -> serves it, degraded', async () => {
    await getBars(['AAA'], FROM, { fetchChart: async () => chart(7), today: '2026-05-14' })
    const failing = vi.fn(async () => { throw new Error('429') })
    const res = await getBars(['AAA'], FROM, { fetchChart: failing, today: TODAY })

    expect(res.get('AAA')).toMatchObject({ degraded: true, missing: false })
    expect(res.get('AAA')!.bars[0].close).toBe(7)
  })

  it('S8.2: Yahoo fails and nothing is stored -> missing + degraded, nothing invented', async () => {
    const res = await getBars(['AAA'], FROM, { fetchChart: async () => { throw new Error('boom') }, today: TODAY })
    expect(res.get('AAA')).toMatchObject({ bars: [], degraded: true, missing: true })
    expect(store.size).toBe(0)
  })

  it('Yahoo answering with no bars is a fact, not a failure', async () => {
    const res = await getBars(['AAA'], FROM, {
      fetchChart: async () => ({ bars: [], splits: [], splitsKnown: true }), today: TODAY,
    })
    expect(res.get('AAA')).toMatchObject({ bars: [], degraded: false, missing: false })
  })

  it('S11.2: Redis down -> in-memory fallback, still cached for the day', async () => {
    redisUp = false
    const fetchChart = vi.fn(async () => chart())
    await getBars(['AAA'], FROM, { fetchChart, today: TODAY })
    await getBars(['AAA'], FROM, { fetchChart, today: TODAY })
    expect(fetchChart).toHaveBeenCalledTimes(1)
    expect(redisMock.setex).not.toHaveBeenCalled()
  })

  it('S11.1: never writes a key without an expiry', async () => {
    await getBars(['AAA', 'BBB'], FROM, { fetchChart: async () => chart(), today: TODAY })
    expect(redisMock.set).not.toHaveBeenCalled()
    expect(redisMock.setex).toHaveBeenCalledTimes(2)
  })

  it('fetches at most 5 symbols at a time', async () => {
    let inFlight = 0
    let peak = 0
    const fetchChart = async () => {
      peak = Math.max(peak, ++inFlight)
      await new Promise(r => setTimeout(r, 5))
      inFlight--
      return chart()
    }
    await getBars(Array.from({ length: 12 }, (_, i) => `S${i}`), FROM, { fetchChart, today: TODAY })
    expect(peak).toBe(5)
  })
})
