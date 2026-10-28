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
  it('maxAgeSec: a same-day entry is fresh only that long after its fetch; without it, all day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-05-15T14:00:00Z'))
      const fetchChart = vi.fn(async () => chart())
      await getBars(['SPY'], FROM, { fetchChart, today: TODAY, maxAgeSec: 300 })
      vi.setSystemTime(new Date('2026-05-15T14:04:59Z'))
      await getBars(['SPY'], FROM, { fetchChart, today: TODAY, maxAgeSec: 300 })
      expect(fetchChart).toHaveBeenCalledTimes(1)

      vi.setSystemTime(new Date('2026-05-15T14:05:01Z'))
      await getBars(['SPY'], FROM, { fetchChart, today: TODAY, maxAgeSec: 300 })
      expect(fetchChart).toHaveBeenCalledTimes(2)

      vi.setSystemTime(new Date('2026-05-15T22:00:00Z'))
      await getBars(['SPY'], FROM, { fetchChart, today: TODAY })
      expect(fetchChart).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('maxAgeSec: an entry stored without its fetch time is not fresh for it', async () => {
    store.set('bars:v1:SPY', JSON.stringify({ fetchedOn: TODAY, from: '2026-01-02', bars: [['2026-05-14', 99]], splits: [], splitsKnown: true }))
    const fetchChart = vi.fn(async () => chart(5))

    expect((await getBars(['SPY'], FROM, { fetchChart, today: TODAY })).get('SPY')!.bars).toEqual([{ date: '2026-05-14', close: 99 }])
    expect((await getBars(['SPY'], FROM, { fetchChart, today: TODAY, maxAgeSec: 300 })).get('SPY')!.bars).toEqual([{ date: '2026-05-14', close: 5 }])
  })

  it('memoryOnly never reads or writes Redis (read-only scripts must not touch the shared cache)', async () => {
    store.set('bars:v1:AAA', JSON.stringify({ fetchedOn: TODAY, from: '2026-01-02', bars: [['2026-05-14', 99]], splits: [], splitsKnown: true }))
    const fetchChart = vi.fn(async () => chart(5))
    const res = await getBars(['AAA'], FROM, { fetchChart, today: TODAY, memoryOnly: true })
    expect(fetchChart).toHaveBeenCalledTimes(1)
    expect(res.get('AAA')!.bars).toEqual([{ date: '2026-05-14', close: 5 }])
    expect(redisMock.get).not.toHaveBeenCalled()
    expect(redisMock.setex).not.toHaveBeenCalled()
    await getBars(['AAA'], FROM, { fetchChart, today: TODAY, memoryOnly: true })
    expect(fetchChart).toHaveBeenCalledTimes(1) // fresh in the module Map
  })

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

  it('keeps the dividend events with the bars; unknown (null) when the chart did not say', async () => {
    const withDividends = vi.fn(async () => ({ ...chart(), dividends: [{ date: '2026-03-20', amount: 1.5 }] }))
    await getBars(['SPY'], FROM, { fetchChart: withDividends, today: TODAY })
    const again = await getBars(['SPY'], FROM, { fetchChart: withDividends, today: TODAY })
    expect(withDividends).toHaveBeenCalledTimes(1)
    expect(again.get('SPY')!.dividends).toEqual([{ date: '2026-03-20', amount: 1.5 }])

    const unknown = await getBars(['AAA'], FROM, { fetchChart: vi.fn(async () => chart()), today: TODAY })
    expect(unknown.get('AAA')!.dividends).toBeNull()
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
  })

  it('Yahoo answering with no bars is a fact, not a failure', async () => {
    const res = await getBars(['AAA'], FROM, {
      fetchChart: async () => ({ bars: [], splits: [], splitsKnown: true }), today: TODAY,
    })
    expect(res.get('AAA')).toMatchObject({ bars: [], degraded: false, missing: false })
  })

  it('W2a: an entry with unknown splits is not fresh, chart() is retried on the next request', async () => {
    const fetchChart = vi.fn(async () => ({ ...chart(), splitsKnown: false }))
    await getBars(['AAA'], FROM, { fetchChart, today: TODAY })
    fetchChart.mockResolvedValueOnce(chart())
    const again = await getBars(['AAA'], FROM, { fetchChart, today: TODAY })
    expect(fetchChart).toHaveBeenCalledTimes(2)
    expect(again.get('AAA')).toMatchObject({ splitsKnown: true, degraded: false })
  })

  it('W1: a symbol that fails with nothing stored gets a 1h negative marker, still degraded, no refetch', async () => {
    const fetchChart = vi.fn(async () => { throw new Error('delisted') })
    await getBars(['AAA'], FROM, { fetchChart, today: TODAY })
    const again = await getBars(['AAA'], FROM, { fetchChart, today: TODAY })
    expect(fetchChart).toHaveBeenCalledTimes(1)
    expect(redisMock.setex).toHaveBeenCalledWith('bars:v1:AAA', 3600, expect.any(String))
    expect(again.get('AAA')).toMatchObject({ bars: [], degraded: true, missing: true })
  })

  it('a caller that wants fresh bars (maxAgeSec) retries a missing symbol after that long, not after an hour', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const fetchChart = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(chart())
    await getBars(['AAA'], FROM, { fetchChart, today: TODAY, maxAgeSec: 300 })
    vi.setSystemTime(Date.now() + 301_000)

    const again = await getBars(['AAA'], FROM, { fetchChart, today: TODAY, maxAgeSec: 300 })

    expect(fetchChart).toHaveBeenCalledTimes(2)
    expect(again.get('AAA')).toMatchObject({ degraded: false, missing: false })
    vi.useRealTimers()
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
