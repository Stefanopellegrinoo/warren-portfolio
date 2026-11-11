/**
 * Peso-line prices from data912 (/live/arg_cedears, /live/arg_stocks), cached as
 * last-known prices under local:{SYMBOL}.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCachePrice = vi.fn()
vi.mock('../yahoo-finance', () => ({
  fetchQuotes: vi.fn(async () => new Map()),
  cachePrice: (...a: unknown[]) => mockCachePrice(...a),
}))
vi.mock('../supabase-server', () => ({ createServiceClient: vi.fn(), createServerClientInstance: vi.fn() }))

const { refreshLocalPrices, localPriceKey } = await import('../data912-client')

const CEDEARS = 'https://data912.com/live/arg_cedears'
const STOCKS = 'https://data912.com/live/arg_stocks'
const row = (symbol: string, c: number, pct_change: number) => ({ symbol, c, pct_change, px_bid: c, px_ask: c, v: 1 })

function feeds(byUrl: Record<string, unknown>) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    const body = byUrl[url]
    if (body instanceof Error) throw body
    return { ok: true, status: 200, json: async () => body } as Response
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCachePrice.mockResolvedValue(undefined)
})

describe('refreshLocalPrices', () => {
  it('caches the peso-line close and day change of every held ticker, one GET per feed with a timeout', async () => {
    const fetchFn = feeds({
      [CEDEARS]: [row('AAPL', 28_420, 1.21), row('AAPLD', 18.3, 0.77), row('MSFT', 28_840, -0.55), row('GGAL', 1, 0)],
      [STOCKS]: [row('GGAL', 7000, 2), row('AAPL', 1, 0)],
    })

    const n = await refreshLocalPrices(['AAPL', 'MSFT', 'BCBA:GGAL', 'DIS'], fetchFn as unknown as typeof fetch)

    expect(n).toBe(3)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(fetchFn.mock.calls.map(c => c[0]).sort()).toEqual([CEDEARS, STOCKS])
    for (const call of fetchFn.mock.calls) expect(call[1]?.signal).toBeInstanceOf(AbortSignal)

    const cached = Object.fromEntries(mockCachePrice.mock.calls.map(([k, q]) => [k, q]))
    expect(Object.keys(cached).sort()).toEqual(['local:AAPL', 'local:GGAL', 'local:MSFT'])
    // CEDEAR symbols come from the CEDEAR feed and BCBA: shares from the stocks feed.
    expect(cached['local:AAPL']).toMatchObject({ ticker: 'AAPL', price: 28_420, changePercent: 0.0121 })
    expect(cached['local:AAPL'].previousClose).toBeCloseTo(28_420 / 1.0121, 9)
    expect(cached['local:AAPL'].change).toBeCloseTo(28_420 - 28_420 / 1.0121, 9)
    expect(typeof cached['local:AAPL'].updatedAt).toBe('string')
    expect(cached['local:MSFT']).toMatchObject({ ticker: 'MSFT', price: 28_840 })
    expect(cached['local:MSFT'].changePercent).toBeCloseTo(-0.0055, 12)
    expect(cached['local:GGAL']).toMatchObject({ ticker: 'GGAL', price: 7000, changePercent: 0.02 })
    expect(localPriceKey('AAPL')).toBe('local:AAPL')
  })

  it('a failed feed is logged and leaves its last-known prices alone; the other feed still updates', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchFn = feeds({ [CEDEARS]: new Error('timeout'), [STOCKS]: [row('GGAL', 7000, 0)] })

    const n = await refreshLocalPrices(['AAPL', 'BCBA:GGAL'], fetchFn as unknown as typeof fetch)

    expect(n).toBe(1)
    expect(mockCachePrice.mock.calls.map(c => c[0])).toEqual(['local:GGAL'])
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('last-known'), expect.anything())
    errSpy.mockRestore()
  })

  it('never caches a missing or zero close', async () => {
    const fetchFn = feeds({ [CEDEARS]: [row('AAPL', 0, 0)], [STOCKS]: { error: 'not an array' } })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await refreshLocalPrices(['AAPL', 'BCBA:GGAL'], fetchFn as unknown as typeof fetch)).toBe(0)
    expect(mockCachePrice).not.toHaveBeenCalled()
  })

  it('no held ticker: no request', async () => {
    const fetchFn = feeds({})
    expect(await refreshLocalPrices([], fetchFn as unknown as typeof fetch)).toBe(0)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

// After an Argentine holiday the CEDEAR feed's pct_change is measured against the last AR close,
// several US sessions back. "Today" is then the US session's own change.
describe('refreshLocalPrices — day change after an Argentine holiday', () => {
  const HISTORY = 'https://data912.com/historical/cedears/SPY'
  const bars = (...dates: string[]) => dates.map(date => ({ date, c: 1 }))
  const us = new Map([['NVDA', { changePercent: 0.027 }], ['AAPL', { changePercent: -0.01 }]])
  // 12:30 in Buenos Aires.
  const at = (day: string) => new Date(`${day}T15:30:00Z`)

  it('the first session after an AR holiday takes the US change of the day, and keeps the peso price', async () => {
    const fetchFn = feeds({
      [CEDEARS]: [row('NVDA', 12_140, -6.9)],
      // Last AR session Friday 06/11; Monday 09/11 and Tuesday 10/11 had no AR market.
      [HISTORY]: bars('2026-11-05', '2026-11-06'),
    })

    expect(await refreshLocalPrices(['NVDA'], fetchFn as unknown as typeof fetch, us, at('2026-11-11'))).toBe(1)

    const [key, q] = mockCachePrice.mock.calls[0]
    expect(key).toBe('local:NVDA')
    expect(q.price).toBe(12_140)
    expect(q.changePercent).toBeCloseTo(0.027, 12)
    expect(q.previousClose).toBeCloseTo(12_140 / 1.027, 9)
    expect(q.change).toBeCloseTo(12_140 - 12_140 / 1.027, 9)
  })

  it('a normal day keeps the feed change: the last AR session is the previous weekday', async () => {
    const fetchFn = feeds({
      [CEDEARS]: [row('NVDA', 12_140, 1.5)],
      [HISTORY]: bars('2026-11-12', '2026-11-13'),
    })

    // Monday 16/11: the previous weekday is Friday 13/11, an AR session.
    await refreshLocalPrices(['NVDA'], fetchFn as unknown as typeof fetch, us, at('2026-11-16'))

    expect(mockCachePrice.mock.calls[0][1].changePercent).toBeCloseTo(0.015, 12)
  })

  it('a bar of today in the history does not hide the holiday', async () => {
    const fetchFn = feeds({
      [CEDEARS]: [row('NVDA', 12_140, -6.9)],
      [HISTORY]: bars('2026-11-06', '2026-11-18'),
    })

    // Wednesday 18/11 after a made-up AR holiday on Tuesday 17/11.
    await refreshLocalPrices(['NVDA'], fetchFn as unknown as typeof fetch, us, at('2026-11-18'))

    expect(mockCachePrice.mock.calls[0][1].changePercent).toBeCloseTo(0.027, 12)
  })

  it('a failed history request keeps the feed change', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchFn = feeds({ [CEDEARS]: [row('NVDA', 12_140, -6.9)], [HISTORY]: new Error('timeout') })

    await refreshLocalPrices(['NVDA'], fetchFn as unknown as typeof fetch, us, at('2026-11-19'))

    expect(mockCachePrice.mock.calls[0][1].changePercent).toBeCloseTo(-0.069, 12)
  })

  it('a CEDEAR without a US quote and a local share keep the feed change', async () => {
    const fetchFn = feeds({
      [CEDEARS]: [row('MSFT', 28_840, 4)],
      [STOCKS]: [row('GGAL', 7000, 5)],
      [HISTORY]: bars('2026-11-06'),
    })

    await refreshLocalPrices(['MSFT', 'BCBA:GGAL'], fetchFn as unknown as typeof fetch, us, at('2026-11-20'))

    const cached = Object.fromEntries(mockCachePrice.mock.calls.map(([k, q]) => [k, q]))
    expect(cached['local:MSFT'].changePercent).toBeCloseTo(0.04, 12)
    expect(cached['local:GGAL'].changePercent).toBeCloseTo(0.05, 12)
  })
})
