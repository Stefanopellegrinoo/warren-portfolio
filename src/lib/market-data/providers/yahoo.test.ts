import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MarketDataError } from '../types'

// ── Mock yahoo-finance singleton ─────────────────────────────────────────────
const mockHistorical = vi.fn()
const mockYahooInstance = { historical: mockHistorical }

vi.mock('../../yahoo-finance', () => ({
  normalizeTickerForYahoo: (ticker: string) => {
    // Simple normalization: BCBA:GGAL → GGAL.BA, NASDAQ:AAPL → AAPL
    const parts = ticker.split(':')
    if (parts.length === 1) return ticker
    const [exchange, symbol] = parts
    if (exchange.toUpperCase() === 'BCBA') return `${symbol}.BA`
    return symbol
  },
  getYahooFinanceInstance: vi.fn().mockResolvedValue(mockYahooInstance),
}))

vi.mock('../../currency', () => ({
  getHistoricalCCL: vi.fn().mockResolvedValue(new Map()),
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
