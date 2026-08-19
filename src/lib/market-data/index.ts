import { YahooProvider } from './providers/yahoo'
import type { MarketDataProvider } from './types'

// ── Singleton factory ────────────────────────────────────────────────────────
let cached: MarketDataProvider | null = null

export function getMarketDataProvider(): MarketDataProvider {
  if (cached) return cached
  cached = new YahooProvider()
  return cached
}

// ── Re-exports ───────────────────────────────────────────────────────────────
export type { MarketDataProvider, Candle, Quote, SearchResult, CandleInterval } from './types'
export { MarketDataError } from './types'
export type { MarketDataErrorCode } from './types'
