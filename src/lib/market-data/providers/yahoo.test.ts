import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MarketDataError } from '../types'

// ── Mock yahoo-finance singleton ─────────────────────────────────────────────
const mockHistorical = vi.fn()
const mockSearch = vi.fn()
const mockYahooInstance = { historical: mockHistorical, search: mockSearch }

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

  it('calls historical with period1: new Date(0) when from is not provided', async () => {
    const { YahooProvider } = await import('./yahoo')
    const provider = new YahooProvider()

    mockHistorical.mockResolvedValue([
      makeFakeHistoricalRow('2024-01-15'),
      makeFakeHistoricalRow('2024-01-16'),
    ])

    await provider.getCandles('AAPL', '1d')

    expect(mockHistorical).toHaveBeenCalledWith(
      'AAPL',
      expect.objectContaining({
        period1: new Date(0),
      })
    )
  })

  it('returns Candle[] with time field as YYYY-MM-DD string', async () => {
    const { YahooProvider } = await import('./yahoo')
    const provider = new YahooProvider()

    mockHistorical.mockResolvedValue([
      makeFakeHistoricalRow('2024-01-15'),
    ])

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

    mockHistorical.mockResolvedValue([
      makeFakeHistoricalRow('2023-01-02'),
    ])

    await provider.getCandles('AAPL', '1d', fromDate)

    expect(mockHistorical).toHaveBeenCalledWith(
      'AAPL',
      expect.objectContaining({ period1: fromDate })
    )
  })

  it('maps 1w interval to 1wk for Yahoo Finance', async () => {
    const { YahooProvider } = await import('./yahoo')
    const provider = new YahooProvider()

    mockHistorical.mockResolvedValue([makeFakeHistoricalRow('2024-01-15')])

    await provider.getCandles('AAPL', '1w')

    expect(mockHistorical).toHaveBeenCalledWith(
      'AAPL',
      expect.objectContaining({ interval: '1wk' })
    )
  })
})

describe('YahooProvider.getCandles — retry logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retries once on failure and returns data on second call', async () => {
    const { YahooProvider } = await import('./yahoo')
    const provider = new YahooProvider()

    mockHistorical
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce([makeFakeHistoricalRow('2024-01-15')])

    const candles = await provider.getCandles('AAPL', '1d')
    expect(candles).toHaveLength(1)
    expect(mockHistorical).toHaveBeenCalledTimes(2)
  })

  it('throws MarketDataError with PROVIDER_UNAVAILABLE after 2 failures', async () => {
    const { YahooProvider } = await import('./yahoo')
    const provider = new YahooProvider()

    mockHistorical
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

    mockHistorical
      .mockRejectedValueOnce(new Error('No data found for symbol'))
      .mockRejectedValueOnce(new Error('No data found for symbol'))

    await expect(provider.getCandles('INVALID', '1d')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
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
    mockHistorical.mockResolvedValue([makeFakeHistoricalRow('2024-01-15')])

    const candles = await provider.getCandles('BCBA:GGAL', '1d')

    expect(candles[0]).toMatchObject({ open: 0.15, high: 0.155, low: 0.148, close: 0.152 })
  })

  it('refuses the candle when the day has no CCL rate instead of returning ARS as USD', async () => {
    const { YahooProvider } = await import('./yahoo')
    const provider = new YahooProvider()

    // Rate present for the 15th, missing for the 16th. Falling through on the
    // 16th used to leave that candle in pesos — a bar ~1000x its neighbour.
    mockGetHistoricalCCL.mockResolvedValue(new Map([['2024-01-15', 1000]]))
    mockHistorical.mockResolvedValue([
      makeFakeHistoricalRow('2024-01-15'),
      makeFakeHistoricalRow('2024-01-16'),
    ])

    await expect(provider.getCandles('BCBA:GGAL', '1d')).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      message: expect.stringContaining('No historical CCL rate'),
    })
  })

  it('keeps the refusal a MarketDataError through the enclosing catch', async () => {
    const { YahooProvider } = await import('./yahoo')
    const provider = new YahooProvider()

    mockGetHistoricalCCL.mockResolvedValue(new Map<string, number>())
    mockHistorical.mockResolvedValue([makeFakeHistoricalRow('2024-01-15')])

    // classifyError returns a MarketDataError untouched; a plain Error would be
    // re-read by message and could come out as something else entirely.
    await expect(provider.getCandles('BCBA:GGAL', '1d')).rejects.toBeInstanceOf(MarketDataError)
  })

  it('leaves a non-BCBA ticker alone even when no CCL rates exist', async () => {
    const { YahooProvider } = await import('./yahoo')
    const provider = new YahooProvider()

    mockHistorical.mockResolvedValue([makeFakeHistoricalRow('2024-01-15')])

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
