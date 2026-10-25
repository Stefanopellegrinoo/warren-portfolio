import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MarketDataError } from '../market-data/types'

// odd/tasks/chart-customization.md S7: an indicator alert reads the candles the chart reads, and says
// whether a failure can pass (a timeout, a 5xx) or cannot (an unknown ticker, no candles).

const mockFetchKlines = vi.fn()
vi.mock('../binance/rest', () => ({ fetchServerKlines: (...a: unknown[]) => mockFetchKlines(...a) }))
const mockGetCandles = vi.fn()
vi.mock('../market-data', async () => ({
  getMarketDataProvider: () => ({ getCandles: (...a: unknown[]) => mockGetCandles(...a) }),
  MarketDataError: (await import('../market-data/types')).MarketDataError,
}))

const { loadCandles, CANDLE_TIMEOUT_MS } = await import('../alert-candles')

const DAY = 86_400_000
const kline = { time: 1_760_000_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, isFinal: true }

beforeEach(() => {
  mockFetchKlines.mockReset()
  mockGetCandles.mockReset()
})

describe('loadCandles', () => {
  it('a crypto ticker: the 1000 Binance bars the chart loads', async () => {
    mockFetchKlines.mockResolvedValueOnce([kline])

    expect(await loadCandles('BTCUSDT', '4h')).toEqual({ ok: true, candles: [kline] })
    expect(mockFetchKlines).toHaveBeenCalledWith('BTCUSDT', '4h', 1000)
    expect(mockGetCandles).not.toHaveBeenCalled()
  })

  it('a stock: the history the chart asks the market-data provider for, in chart time', async () => {
    mockGetCandles.mockResolvedValueOnce([{ time: '2026-10-20', open: 1, high: 2, low: 0.5, close: 1.5 }])

    const load = await loadCandles('AAPL', '1d')

    expect(load).toEqual({ ok: true, candles: [{ time: Date.parse('2026-10-20T00:00:00Z') / 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 0 }] })
    const [ticker, interval, from] = mockGetCandles.mock.calls[0]
    expect([ticker, interval]).toEqual(['AAPL', '1d'])
    expect(Math.abs(Date.now() - 3650 * DAY - (from as Date).getTime())).toBeLessThan(60_000)
    expect(mockFetchKlines).not.toHaveBeenCalled()
  })

  it('a stock on 1M asks for every monthly bar, intraday for the days the chart loads', async () => {
    mockGetCandles.mockResolvedValue([{ time: 1_760_000_000, open: 1, high: 1, low: 1, close: 1, volume: 5 }])

    await loadCandles('SPY', '1M')
    await loadCandles('SPY', '15m')

    expect(mockGetCandles.mock.calls[0]).toEqual(['SPY', '1mo', undefined])
    const [, interval, from] = mockGetCandles.mock.calls[1]
    expect(interval).toBe('15m')
    expect(Math.abs(Date.now() - 59 * DAY - (from as Date).getTime())).toBeLessThan(60_000)
  })

  it('a timeframe the source does not serve has no candles, without asking', async () => {
    expect(await loadCandles('AAPL', '4h')).toMatchObject({ ok: false, kind: 'empty' })
    expect(mockGetCandles).not.toHaveBeenCalled()
  })

  it('an empty answer has no candles', async () => {
    mockFetchKlines.mockResolvedValueOnce([])

    expect(await loadCandles('BTCUSDT', '1h')).toMatchObject({ ok: false, kind: 'empty' })
  })

  it('an unknown ticker: Binance answers 400, Yahoo NOT_FOUND', async () => {
    mockFetchKlines.mockRejectedValueOnce(new Error('klines 400'))
    mockGetCandles.mockRejectedValueOnce(new MarketDataError('NOT_FOUND', 'No data found, symbol may be delisted'))

    expect(await loadCandles('NOPEUSDT', '1h')).toEqual({ ok: false, kind: 'unknown', error: 'klines 400' })
    expect(await loadCandles('NOPE', '1d')).toEqual({ ok: false, kind: 'unknown', error: 'No data found, symbol may be delisted' })
  })

  it('a failure that can pass: a 5xx, a refusal, a rate limit, a dropped connection', async () => {
    mockFetchKlines.mockRejectedValueOnce(new Error('klines 503')).mockRejectedValueOnce(new Error('klines 451')).mockRejectedValueOnce(new TypeError('fetch failed'))
    mockGetCandles.mockRejectedValueOnce(new MarketDataError('RATE_LIMITED', '429')).mockRejectedValueOnce(new MarketDataError('PROVIDER_UNAVAILABLE', 'No CCL rate'))

    for (const ticker of ['BTCUSDT', 'BTCUSDT', 'BTCUSDT', 'AAPL', 'AAPL']) {
      expect(await loadCandles(ticker, '1h')).toMatchObject({ ok: false, kind: 'transient' })
    }
  })

  describe('a source that never answers', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('is a failure that can pass once the timeout is over', async () => {
      mockFetchKlines.mockReturnValueOnce(new Promise(() => {}))

      const load = loadCandles('BTCUSDT', '1h')
      await vi.advanceTimersByTimeAsync(CANDLE_TIMEOUT_MS)

      expect(await load).toMatchObject({ ok: false, kind: 'transient', error: `no answer in ${CANDLE_TIMEOUT_MS} ms` })
    })
  })
})
