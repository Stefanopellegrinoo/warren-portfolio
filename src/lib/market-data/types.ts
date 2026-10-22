// ── Market Data Types ───────────────────────────────────────────────────────
// Candle: compatible with yahoo-finance2 historical() output and lightweight-charts.
// lightweight-charts requires `time` as UTCTimestamp (seconds) or business-day string YYYY-MM-DD.
// Daily and longer emit `time: string` (YYYY-MM-DD); intraday emits UTC seconds.
export interface Candle {
  time: string | number  // YYYY-MM-DD (UTC business day), or UTC seconds intraday
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export type CandleInterval = '15m' | '1h' | '1d' | '1w' | '1mo'

export interface Quote {
  ticker: string       // original input (e.g. "BCBA:GGAL")
  price: number        // USD (BCBA already normalized via CCL)
  change: number
  changePercent: number
  previousClose: number
  updatedAt: string    // ISO
}

export interface SearchResult {
  symbol: string       // raw provider symbol (e.g. "AAPL", "GGAL.BA")
  shortname: string    // "Apple Inc."
  exchange: string     // "NMS", "BUE", etc.
  quoteType?: 'EQUITY' | 'ETF' | 'CRYPTOCURRENCY' | 'CURRENCY' | 'INDEX'
}

export interface MarketDataProvider {
  getCandles(ticker: string, interval: CandleInterval, from?: Date): Promise<Candle[]>
  getQuote(ticker: string): Promise<Quote>
  searchTickers(q: string): Promise<SearchResult[]>
}

export type MarketDataErrorCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'UNKNOWN'

export class MarketDataError extends Error {
  constructor(
    public code: MarketDataErrorCode,
    message: string,
    public cause?: unknown
  ) {
    super(message)
    this.name = 'MarketDataError'
  }
}
