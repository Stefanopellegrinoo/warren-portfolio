// Shared shapes for the asset page's fundamentals sources (odd/tasks/asset-page.md, S5).
// Each source fills these; the metrics module only reads them.

/** TradingView scanner markets the asset page supports. */
export type Market = 'america' | 'argentina'

/** One value of a statement line or a metric. `end` is the period end, YYYY-MM-DD. */
export interface Point {
  end: string
  value: number
}

/** Oldest first, no gaps filled in: a missing period is simply absent. */
export type Series = Point[]

export type FundamentalsSource = 'tradingview' | 'yahoo' | 'sec' | 'news'

/**
 * What a source throws. `not_found`: the source answered and has no such asset or data.
 * `unavailable`: network, timeout or HTTP error. `bad_shape`: it answered something we cannot read.
 */
export class FundamentalsSourceError extends Error {
  constructor(
    readonly source: FundamentalsSource,
    readonly code: 'not_found' | 'unavailable' | 'bad_shape',
    message: string,
  ) {
    super(`${source}: ${message}`)
    this.name = 'FundamentalsSourceError'
  }
}

/** An asset as each source names it. */
export interface AssetRef {
  /** As the app stores it: `MELI`, `BCBA:GGAL`. */
  ticker: string
  market: Market
  /** TradingView symbol with its exchange: `NASDAQ:MELI`, `BCBA:GGAL`. */
  tvSymbol: string
  /** Yahoo symbol: `MELI`, `GGAL.BA`. */
  yahooSymbol: string
}
