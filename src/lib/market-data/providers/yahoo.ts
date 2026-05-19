import type { MarketDataProvider, Candle, CandleInterval, Quote, SearchResult } from '../types'
import { MarketDataError } from '../types'
import { normalizeTickerForYahoo, getYahooFinanceInstance } from '../../yahoo-finance'
import { getHistoricalCCL, getCCLRate } from '../../currency'

// ── Helper: retry once on transient errors ───────────────────────────────────
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (_firstErr) {
    // Retry exactly once
    return await fn()
  }
}

// ── Helper: classify Yahoo errors into typed MarketDataError ─────────────────
function classifyError(err: unknown): MarketDataError {
  if (err instanceof MarketDataError) return err
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('No fundamentals data found') || msg.includes('No data found')) {
    return new MarketDataError('NOT_FOUND', msg, err)
  }
  if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
    return new MarketDataError('RATE_LIMITED', msg, err)
  }
  return new MarketDataError('PROVIDER_UNAVAILABLE', msg, err)
}

export class YahooProvider implements MarketDataProvider {
  // ── getCandles ─────────────────────────────────────────────────────────────
  async getCandles(ticker: string, interval: CandleInterval, from?: Date): Promise<Candle[]> {
    const symbol = normalizeTickerForYahoo(ticker)
    const period1 = from ?? new Date(0)   // epoch = maximum history
    const period2 = new Date()

    // Map CandleInterval to Yahoo Finance interval string
    const yfInterval = interval === '1w' ? '1wk' : interval === '1mo' ? '1mo' : '1d'

    try {
      const yahooFinance = await getYahooFinanceInstance()

      const result = await withRetry(() =>
        yahooFinance.historical(symbol, { period1, period2, interval: yfInterval })
      ) as any[]

      // Normalize ARS → USD for BCBA tickers
      let hCcl: Map<string, number> | null = null
      if (ticker.startsWith('BCBA:')) {
        hCcl = await getHistoricalCCL(period1, period2)
      }

      const candles: Candle[] = result.map((row: any) => {
        const dateStr = (row.date as Date).toISOString().split('T')[0]
        let open = row.open ?? 0
        let high = row.high ?? 0
        let low = row.low ?? 0
        let close = row.close ?? 0

        if (hCcl) {
          const rate = hCcl.get(dateStr)
          if (rate) {
            open = open / rate
            high = high / rate
            low = low / rate
            close = close / rate
          }
        }

        return {
          time: dateStr,
          open,
          high,
          low,
          close,
          volume: row.volume ?? 0,
        }
      })

      return candles
    } catch (err) {
      throw classifyError(err)
    }
  }

  // ── getQuote ───────────────────────────────────────────────────────────────
  async getQuote(ticker: string): Promise<Quote> {
    const symbol = normalizeTickerForYahoo(ticker)
    const now = new Date()

    try {
      const yahooFinance = await getYahooFinanceInstance()

      const result = await withRetry(() =>
        yahooFinance.quote(symbol, {
          fields: ['regularMarketPrice', 'regularMarketChange', 'regularMarketChangePercent', 'regularMarketPreviousClose'],
        })
      ) as any

      if (!result || result.regularMarketPrice == null) {
        throw new MarketDataError('NOT_FOUND', `No quote data for ${ticker}`)
      }

      let price = result.regularMarketPrice
      let change = result.regularMarketChange ?? 0

      // BCBA prices from Yahoo are in ARS — convert to USD via CCL
      if (ticker.startsWith('BCBA:')) {
        try {
          const ccl = await getCCLRate()
          if (ccl > 0) {
            price = price / ccl
            change = change / ccl
          }
        } catch {
          // If CCL unavailable, leave as-is
        }
      }

      return {
        ticker,
        price,
        change,
        changePercent: (result.regularMarketChangePercent ?? 0),
        previousClose: result.regularMarketPreviousClose ?? price - change,
        updatedAt: now.toISOString(),
      }
    } catch (err) {
      throw classifyError(err)
    }
  }

  // ── searchTickers ──────────────────────────────────────────────────────────
  // Stub for PR 1 — implemented fully in PR 2
  async searchTickers(_q: string): Promise<SearchResult[]> {
    return []
  }
}
