import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MarketDataError } from '../types'

// ── Mock yahoo-finance singleton ─────────────────────────────────────────────
const mockHistorical = vi.fn()
const mockSearch = vi.fn()
const mockChart = vi.fn()
const mockYahooInstance = { historical: mockHistorical, search: mockSearch, chart: mockChart }

const mockNormalizeTickerForYahoo = vi.fn((ticker: string) => {
  // Simple normalization: BCBA:GGAL → GGAL.BA, NASDAQ:AAPL → AAPL
  const parts = ticker.split(':')
  if (parts.length === 1) return ticker
  const [exchange, symbol] = parts
  if (exchange.toUpperCase() === 'BCBA') return `${symbol}.BA`
  return symbol
})

vi.mock('../../yahoo-finance', () => ({
  normalizeTickerForYahoo: mockNormalizeTickerForYahoo,
  getYahooFinanceInstance: vi.fn().mockResolvedValue(mockYahooInstance),
}))

const mockGetHistoricalCCL = vi.fn(async () => new Map<string, number>())
const mockGetCCLRate = vi.fn(async () => 1000)

vi.mock('../../currency', () => ({
  getHistoricalCCL: (...args: unknown[]) => mockGetHistoricalCCL(...(args as [])),
  getCCLRate: (...args: unknown[]) => mockGetCCLRate(...(args as [])),
}))

// The daily path reads chart() too: its rows arrive as `quotes`.
const daily = (rows: any[]) => ({ quotes: rows })

function makeFakeHistoricalRow(dateStr: string, overrides?: Partial<any>) {
  return {
    date: new Date(dateStr + 'T00:00:00Z'),
    open: 150,
    high: 155,
    low: 148,
    close: 152,
    volume: 1000000,
    ...overrides,
  }
}

describe('YahooProvider.getCandles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('asks chart() with period1: new Date(0) when from is not provided', async () => {
    const { YahooProvider } = await import('./yahoo')
    const provider = new YahooProvider()

    mockChart.mockResolvedValue(daily([
      makeFakeHistoricalRow('2024-01-15'),
      makeFakeHistoricalRow('2024-01-16'),
    ]))

    await provider.getCandles('AAPL', '1d')

    expect(mockChart).toHaveBeenCalledWith(
      'AAPL',
      expect.objectContaining({
        period1: new Date(0),
      })
    )
  })

  it('returns Candle[] with time field as YYYY-MM-DD string', async () => {
    const { YahooProvider } = await import('./yahoo')
    const provider = new YahooProvider()

    mockChart.mockResolvedValue(daily([
      makeFakeHistoricalRow('2024-01-15'),
    ]))

    const candles = await provider.getCandles('AAPL', '1d')

    expect(candles).toHaveLength(1)
    expect(candles[0].time).toBe('2024-01-15')
    expect(typeof candles[0].open).toBe('number')
    expect(typeof candles[0].close).toBe('number')
  })

  it('uses provided from date as period1', async () => {
    const { YahooProvider } = await import('./yahoo')
    const provider = new YahooProvider()
    const fromDate = new Date('2023-01-01T00:00:00Z')

    mockChart.mockResolvedValue(daily([
      makeFakeHistoricalRow('2023-01-02'),
    ]))

    await provider.getCandles('AAPL', '1d', fromDate)

    expect(mockChart).toHaveBeenCalledWith(
      'AAPL',
      expect.objectContaining({ period1: fromDate })
    )
  })

  it('keeps the series when Yahoo sends a bar with a null close, as it does for today mid-session', async () => {
    const { YahooProvider } = await import('./yahoo')
    // historical() rejects the whole series for one such bar: every daily chart failed while it was open.
    mockHistorical.mockRejectedValue(new Error('Historical returned a result with SOME (but not all) null values.'))
    mockChart.mockResolvedValue(daily([
      makeFakeHistoricalRow('2024-01-15'),
      makeFakeHistoricalRow('2024-01-16', { close: null }),
    ]))

    const candles = await new YahooProvider().getCandles('AAPL', '1d')

    expect(candles).toEqual([{ time: '2024-01-15', open: 150, high: 155, low: 148, close: 152, volume: 1000000 }])
    mockHistorical.mockReset()
  })

  it('closes today\'s bar at the live price when Yahoo leaves its close empty', async () => {
    const { YahooProvider } = await import('./yahoo')
    mockChart.mockResolvedValue({
      quotes: [makeFakeHistoricalRow('2024-01-15'), makeFakeHistoricalRow('2024-01-16', { close: null })],
      meta: { regularMarketPrice: 160, regularMarketTime: new Date('2024-01-16T21:00:00Z') },
    })

    const candles = await new YahooProvider().getCandles('AAPL', '1d')

    expect(candles.map((c) => c.time)).toEqual(['2024-01-15', '2024-01-16'])
    expect(candles[1]).toMatchObject({ open: 150, high: 160, low: 148, close: 160 })
  })

  it('maps 1w interval to 1wk for Yahoo Finance', async () => {
    const { YahooProvider } = await import('./yahoo')
    const provider = new YahooProvider()

    mockChart.mockResolvedValue(daily([makeFakeHistoricalRow('2024-01-15')]))

    await provider.getCandles('AAPL', '1w')

    expect(mockChart).toHaveBeenCalledWith(
      'AAPL',
      expect.objectContaining({ interval: '1wk' })
    )
  })
})

describe('YahooProvider.getCandles — intraday', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const bar = (iso: string, close: number | null = 152) =>
    ({ date: new Date(iso), open: 150, high: 155, low: 148, close, volume: 10 })

  it('reads 15m bars from chart() and returns UTC-second times', async () => {
    const { YahooProvider } = await import('./yahoo')
    const from = new Date('2026-09-01T00:00:00Z')
    mockChart.mockResolvedValue({ quotes: [bar('2026-10-20T14:30:00Z')] })

    const candles = await new YahooProvider().getCandles('AAPL', '15m', from)

    expect(mockChart).toHaveBeenCalledWith('AAPL', expect.objectContaining({ period1: from, interval: '15m' }))
    expect(mockHistorical).not.toHaveBeenCalled()
    expect(candles).toEqual([{ time: 1792506600, open: 150, high: 155, low: 148, close: 152, volume: 10 }])
  })

  it('drops the empty bars chart() returns for gaps', async () => {
    const { YahooProvider } = await import('./yahoo')
    // Yahoo pads a gap with a bar whose every price is null.
    const pad = { date: new Date('2026-10-20T14:30:00Z'), open: null, high: null, low: null, close: null, volume: null }
    mockChart.mockResolvedValue({ quotes: [pad, bar('2026-10-20T14:45:00Z')] })

    const candles = await new YahooProvider().getCandles('AAPL', '1h', new Date('2026-09-01'))

    expect(candles.map((c) => c.time)).toEqual([1792507500])
  })

  it('converts a BCBA intraday bar by its day rate and uses the live rate after the last known day', async () => {
    const { YahooProvider } = await import('./yahoo')
    mockGetHistoricalCCL.mockResolvedValueOnce(new Map([['2026-10-20', 1000]]))
    mockGetCCLRate.mockResolvedValueOnce(1500)
    mockChart.mockResolvedValue({ quotes: [bar('2026-10-20T15:00:00Z', 3000), bar('2026-10-21T15:00:00Z', 3000)] })

    const candles = await new YahooProvider().getCandles('BCBA:GGAL', '15m', new Date('2026-10-01'))

    expect(candles.map((c) => c.close)).toEqual([3, 2])
  })

  it('still refuses a BCBA intraday bar on a past day with no rate', async () => {
    const { YahooProvider } = await import('./yahoo')
    mockGetHistoricalCCL.mockResolvedValueOnce(new Map([['2026-10-21', 1000]]))
    mockChart.mockResolvedValue({ quotes: [bar('2026-10-20T15:00:00Z', 3000), bar('2026-10-21T15:00:00Z', 3000)] })

    await expect(new YahooProvider().getCandles('BCBA:GGAL', '15m', new Date('2026-10-01'))).rejects.toThrow(/No historical CCL rate/)
  })
})

describe('YahooProvider.getCandles — Yahoo\'s loose live point (odd/tasks/chart-display.md S3, S5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('weekly: the last trade after the current week folds into it, no second candle', async () => {
    const { YahooProvider } = await import('./yahoo')
    mockChart.mockResolvedValue(daily([
      { ...makeFakeHistoricalRow('2026-10-26'), date: new Date('2026-10-26T04:00:00Z') },
      { ...makeFakeHistoricalRow('2026-11-02'), date: new Date('2026-11-02T05:00:00Z'), close: 139.59 },
      { ...makeFakeHistoricalRow('2026-11-03'), date: new Date('2026-11-03T21:00:03Z'), open: 135.99, close: 139.59 },
    ]))

    const candles = await new YahooProvider().getCandles('AAPL', '1w')

    expect(candles.map((c) => c.time)).toEqual(['2026-10-26', '2026-11-02'])
    expect(candles[1].close).toBe(139.59)
  })

  it('15m: the trailing point updates the current bar instead of drawing a sliver', async () => {
    const { YahooProvider } = await import('./yahoo')
    const at = (iso: string, close: number) => ({ date: new Date(iso), open: 136.9, high: 137, low: 136.3, close, volume: 0 })
    mockChart.mockResolvedValue({ quotes: [at('2026-11-04T15:00:00Z', 136.27), at('2026-11-04T15:15:00Z', 136.4), at('2026-11-04T15:16:19Z', 136.26)] })

    const candles = await new YahooProvider().getCandles('AAPL', '15m', new Date('2026-11-04'))

    expect(candles).toHaveLength(2)
    expect(candles[1]).toMatchObject({ time: Date.parse('2026-11-04T15:15:00Z') / 1000, close: 136.26, low: 136.26 })
  })
})

describe('YahooProvider.getCandles — retry logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retries once on failure and returns data on second call', async () => {
    const { YahooProvider } = await import('./yahoo')
    const provider = new YahooProvider()

    mockChart
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(daily([makeFakeHistoricalRow('2024-01-15')]))

    const candles = await provider.getCandles('AAPL', '1d')
    expect(candles).toHaveLength(1)
    expect(mockChart).toHaveBeenCalledTimes(2)
  })

  it('throws MarketDataError with PROVIDER_UNAVAILABLE after 2 failures', async () => {
    const { YahooProvider } = await import('./yahoo')
    const provider = new YahooProvider()

    mockChart
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'))

    await expect(provider.getCandles('AAPL', '1d')).rejects.toThrow(MarketDataError)

    try {
      await provider.getCandles('AAPL', '1d')
    } catch (err) {
      if (err instanceof MarketDataError) {
        expect(err.code).toBe('PROVIDER_UNAVAILABLE')
      }
    }
  })

  it('throws MarketDataError with NOT_FOUND when Yahoo has no data', async () => {
    const { YahooProvider } = await import('./yahoo')
    const provider = new YahooProvider()

    mockChart
      .mockRejectedValueOnce(new Error('No data found for symbol'))
      .mockRejectedValueOnce(new Error('No data found for symbol'))

    await expect(provider.getCandles('INVALID', '1d')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})

describe('YahooProvider.getCandles — a ticker Yahoo does not know', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is asked once, not twice: retrying cannot find it', async () => {
    const { YahooProvider } = await import('./yahoo')
    mockChart.mockRejectedValue(new Error('No data found for symbol'))

    await expect(new YahooProvider().getCandles('INVALID', '1d')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(mockChart).toHaveBeenCalledTimes(1)
    mockChart.mockReset()
  })
})

describe('YahooProvider.getCandles — ARS→USD normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetHistoricalCCL.mockResolvedValue(new Map<string, number>())
  })

  it('divides every OHLC leg by the day CCL rate for a BCBA ticker', async () => {
    const { YahooProvider } = await import('./yahoo')
    const provider = new YahooProvider()

    mockGetHistoricalCCL.mockResolvedValue(new Map([['2024-01-15', 1000]]))
    mockChart.mockResolvedValue(daily([makeFakeHistoricalRow('2024-01-15')]))

    const candles = await provider.getCandles('BCBA:GGAL', '1d')

    expect(candles[0]).toMatchObject({ open: 0.15, high: 0.155, low: 0.148, close: 0.152 })
  })

  it('refuses the candle when the day has no CCL rate instead of returning ARS as USD', async () => {
    const { YahooProvider } = await import('./yahoo')
    const provider = new YahooProvider()

    // Rate present for the 15th, missing for the 16th. Falling through on the
    // 16th used to leave that candle in pesos — a bar ~1000x its neighbour.
    mockGetHistoricalCCL.mockResolvedValue(new Map([['2024-01-15', 1000]]))
    mockChart.mockResolvedValue(daily([
      makeFakeHistoricalRow('2024-01-15'),
      makeFakeHistoricalRow('2024-01-16'),
    ]))

    await expect(provider.getCandles('BCBA:GGAL', '1d')).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      message: expect.stringContaining('No historical CCL rate'),
    })
  })

  it('keeps the refusal a MarketDataError through the enclosing catch', async () => {
    const { YahooProvider } = await import('./yahoo')
    const provider = new YahooProvider()

    mockGetHistoricalCCL.mockResolvedValue(new Map<string, number>())
    mockChart.mockResolvedValue(daily([makeFakeHistoricalRow('2024-01-15')]))

    // classifyError returns a MarketDataError untouched; a plain Error would be
    // re-read by message and could come out as something else entirely.
    await expect(provider.getCandles('BCBA:GGAL', '1d')).rejects.toBeInstanceOf(MarketDataError)
  })

  it('leaves a non-BCBA ticker alone even when no CCL rates exist', async () => {
    const { YahooProvider } = await import('./yahoo')
    const provider = new YahooProvider()

    mockChart.mockResolvedValue(daily([makeFakeHistoricalRow('2024-01-15')]))

    const candles = await provider.getCandles('AAPL', '1d')

    expect(candles[0].close).toBe(152)
    expect(mockGetHistoricalCCL).not.toHaveBeenCalled()
  })
})

// ── Helper: create a fake Yahoo search quote item ────────────────────────────
function makeFakeSearchQuote(overrides?: Record<string, unknown>) {
  return {
    symbol: 'AAPL',
    shortname: 'Apple Inc.',
    longname: 'Apple Incorporated',
    quoteType: 'EQUITY',
    exchange: 'NMS',
    isYahooFinance: true,
    ...overrides,
  }
}

describe('YahooProvider.searchTickers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNormalizeTickerForYahoo.mockImplementation((ticker: string) => {
      const parts = ticker.split(':')
      if (parts.length === 1) return ticker
      const [exchange, symbol] = parts
      if (exchange.toUpperCase() === 'BCBA') return `${symbol}.BA`
      return symbol
    })
  })

  it('returns SearchResult[] from Yahoo search response filtered to isYahooFinance: true', async () => {
    const { YahooProvider } = await import('./yahoo')
    const provider = new YahooProvider()

    mockSearch.mockResolvedValue({
      quotes: [
        makeFakeSearchQuote({ symbol: 'AAPL', quoteType: 'EQUITY', isYahooFinance: true }),
        makeFakeSearchQuote({ symbol: 'AAPL-NOT', quoteType: 'EQUITY', isYahooFinance: false }),
      ],
    })

    const results = await provider.searchTickers('app')

    expect(results).toHaveLength(1)
    expect(results[0].symbol).toBe('AAPL')
    expect(results[0].quoteType).toBe('EQUITY')
    expect(results[0].exchange).toBe('NMS')
  })

  it('filters out non-allowed quoteTypes (MUTUALFUND, FUTURE, INDEX, CURRENCY)', async () => {
    const { YahooProvider } = await import('./yahoo')
    const provider = new YahooProvider()

    mockSearch.mockResolvedValue({
      quotes: [
        makeFakeSearchQuote({ symbol: 'SPY', quoteType: 'ETF', isYahooFinance: true }),
        makeFakeSearchQuote({ symbol: 'SPXMF', quoteType: 'MUTUALFUND', isYahooFinance: true }),
        makeFakeSearchQuote({ symbol: 'SPXFUT', quoteType: 'FUTURE', isYahooFinance: true }),
        makeFakeSearchQuote({ symbol: 'SPXIDX', quoteType: 'INDEX', isYahooFinance: true }),
        makeFakeSearchQuote({ symbol: 'USDEUR', quoteType: 'CURRENCY', isYahooFinance: true }),
        makeFakeSearchQuote({ symbol: 'BTC-USD', quoteType: 'CRYPTOCURRENCY', isYahooFinance: true }),
      ],
    })

    const results = await provider.searchTickers('sp')

    expect(results).toHaveLength(2)
    const symbols = results.map(r => r.symbol)
    expect(symbols).toContain('SPY')
    expect(symbols).toContain('BTC-USD')
    expect(symbols).not.toContain('SPXMF')
    expect(symbols).not.toContain('SPXFUT')
    expect(symbols).not.toContain('SPXIDX')
    expect(symbols).not.toContain('USDEUR')
  })

  it('uses shortname when available, falls back to longname, then empty string', async () => {
    const { YahooProvider } = await import('./yahoo')
    const provider = new YahooProvider()

    mockSearch.mockResolvedValue({
      quotes: [
        makeFakeSearchQuote({ symbol: 'AAPL', shortname: 'Apple Inc.', longname: 'Apple Incorporated' }),
        makeFakeSearchQuote({ symbol: 'MSFT', shortname: undefined, longname: 'Microsoft Corporation' }),
        makeFakeSearchQuote({ symbol: 'GOOG', shortname: undefined, longname: undefined }),
      ],
    })

    const results = await provider.searchTickers('app')

    expect(results.find(r => r.symbol === 'AAPL')?.shortname).toBe('Apple Inc.')
    expect(results.find(r => r.symbol === 'MSFT')?.shortname).toBe('Microsoft Corporation')
    expect(results.find(r => r.symbol === 'GOOG')?.shortname).toBe('')
  })

  it('returns results when Yahoo answers in a shape the library schema rejects', async () => {
    const { YahooProvider } = await import('./yahoo')
    const provider = new YahooProvider()

    // yahoo-finance2 3.13.2 rejects every search Yahoo answers today (2026-10-25)
    // unless the caller turns its result validation off.
    mockSearch.mockImplementation(async (_q: string, _opts: unknown, moduleOpts?: { validateResult?: boolean }) => {
      if (moduleOpts?.validateResult !== false) throw new Error('Failed Yahoo Schema validation')
      return { quotes: [makeFakeSearchQuote({ symbol: 'NVDA' })] }
    })

    const results = await provider.searchTickers('nvda')

    expect(results.map(r => r.symbol)).toEqual(['NVDA'])
  })

  it('does NOT call normalizeTickerForYahoo for search queries (only used in getCandles)', async () => {
    const { YahooProvider } = await import('./yahoo')
    const provider = new YahooProvider()

    mockSearch.mockResolvedValue({
      quotes: [makeFakeSearchQuote({ symbol: 'AAPL' })],
    })

    await provider.searchTickers('aapl')

    // normalizeTickerForYahoo should NOT be called during search
    expect(mockNormalizeTickerForYahoo).not.toHaveBeenCalled()
  })

  it('US tickers (no suffix) are returned as-is without normalization', async () => {
    const { YahooProvider } = await import('./yahoo')
    const provider = new YahooProvider()

    mockSearch.mockResolvedValue({
      quotes: [
        makeFakeSearchQuote({ symbol: 'AAPL', exchange: 'NMS' }),
        makeFakeSearchQuote({ symbol: 'MSFT', exchange: 'NMS' }),
        makeFakeSearchQuote({ symbol: 'SPY', quoteType: 'ETF', exchange: 'PCX' }),
      ],
    })

    const results = await provider.searchTickers('aa')
    const symbols = results.map(r => r.symbol)

    expect(symbols).toContain('AAPL')
    expect(symbols).toContain('MSFT')
    expect(symbols).toContain('SPY')
    // All symbols pass through unchanged
    symbols.forEach(s => expect(s).not.toContain('.'))
  })

  it('returns empty array when Yahoo returns no quotes', async () => {
    const { YahooProvider } = await import('./yahoo')
    const provider = new YahooProvider()

    mockSearch.mockResolvedValue({ quotes: [] })

    const results = await provider.searchTickers('xyzxyz')
    expect(results).toHaveLength(0)
  })
})

describe('YahooProvider.getQuote without a CCL rate', () => {
  it('throws instead of returning an ARS price as USD', async () => {
    const { YahooProvider } = await import('./yahoo')
    ;(mockYahooInstance as any).quote = vi.fn().mockResolvedValue({ regularMarketPrice: 8000, regularMarketChange: 10 })
    mockGetCCLRate.mockResolvedValueOnce(null as any)
    await expect(new YahooProvider().getQuote('BCBA:GGAL')).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
  })
})

// odd/tasks/extended-hours.md S1.
describe('YahooProvider.getQuote extended hours', () => {
  const pre = { preMarketPrice: 129.88, preMarketChangePercent: -6.95, preMarketTime: new Date('2026-11-04T12:58:48Z') }

  it('asks Yahoo for the pre- and post-market fields and returns the session traded after the close', async () => {
    const { YahooProvider } = await import('./yahoo')
    const quote = vi.fn().mockResolvedValue({ regularMarketPrice: 139.59, regularMarketChange: 4.98, regularMarketChangePercent: 3.7, regularMarketPreviousClose: 134.61, regularMarketTime: new Date('2026-11-03T21:00:03Z'), ...pre })
    ;(mockYahooInstance as any).quote = quote
    const q = await new YahooProvider().getQuote('VST')
    expect(quote.mock.calls[0][1].fields).toEqual(expect.arrayContaining(['regularMarketTime', 'preMarketPrice', 'preMarketChangePercent', 'preMarketTime', 'postMarketPrice', 'postMarketChangePercent', 'postMarketTime']))
    expect(q.extended).toEqual({ session: 'pre', price: 129.88, changePercent: -6.95 })
    expect(q).toMatchObject({ price: 139.59, change: 4.98, changePercent: 3.7, previousClose: 134.61 })
  })

  it('an Argentine stock has none, even if Yahoo sent one: its prices are pesos', async () => {
    const { YahooProvider } = await import('./yahoo')
    ;(mockYahooInstance as any).quote = vi.fn().mockResolvedValue({ regularMarketPrice: 8000, regularMarketChange: 10, regularMarketTime: new Date('2026-11-03T20:00:00Z'), ...pre })
    mockGetCCLRate.mockResolvedValueOnce(1500 as any)
    expect((await new YahooProvider().getQuote('BCBA:GGAL')).extended).toBeNull()
  })
})

