/**
 * Comparing assets on the chart (docs/superpowers/specs/2026-10-26-cartera-compare-design.md):
 * daily series in USD, so a peso ticker never reads as beating a dollar one through inflation.
 * Pure and client-safe; the server side lives in the route and stocks-twr.ts.
 */
import { closeOnOrBefore, type DailyBar } from './historical-prices'

/** The stock portfolio as a series: its TWR index, never its raw value. */
export const PORTFOLIO_SERIES = '__portfolio__'
export const MAX_COMPARE = 5

export interface SeriesPoint { time: string; value: number }
export type SeriesResult = { points: SeriesPoint[] } | { error: 'no_data' }
export interface CompareSeriesResponse {
  series: Record<string, SeriesResult>
  /** ARS per USD, when the request asked for it (a peso chart being compared). */
  ccl?: SeriesPoint[]
}

const TICKER = /^\^?[A-Z0-9][A-Z0-9.=-]{0,14}$/

/** The requested symbols, or null when there are none, more than MAX_COMPARE, or one is not a ticker. */
export function parseCompareSymbols(raw: string | null): string[] | null {
  if (!raw) return null
  const symbols = [...new Set(raw.split(',').map((s) => (s.trim() === PORTFOLIO_SERIES ? PORTFOLIO_SERIES : s.trim().toUpperCase())))]
  if (symbols.length === 0 || symbols.length > MAX_COMPARE) return null
  return symbols.every((s) => s === PORTFOLIO_SERIES || TICKER.test(s)) ? symbols : null
}

/** Quoted in pesos: Buenos Aires tickers and the MERVAL. */
export function isArsSymbol(symbol: string): boolean {
  return symbol.endsWith('.BA') || symbol === '^MERV'
}

/** The Yahoo name of a symbol: a Binance USDT pair is Yahoo's USD pair. */
export function yahooSymbol(symbol: string): string {
  return symbol.endsWith('USDT') ? `${symbol.slice(0, -4)}-USD` : symbol
}

/** Each close in USD: divided by the CCL on or before its day when `ccl` is given; days before the first CCL are dropped. */
export function toUsdDaily(bars: DailyBar[], ccl?: DailyBar[]): SeriesPoint[] {
  const out: SeriesPoint[] = []
  for (const bar of bars) {
    const rate = ccl ? closeOnOrBefore(ccl, bar.date) : 1
    if (rate === null || !(rate > 0)) continue
    out.push({ time: bar.date, value: bar.close / rate })
  }
  return out
}

/** How a series is named on screen. */
export function seriesLabel(symbol: string): string {
  if (symbol === PORTFOLIO_SERIES) return 'Mi cartera'
  if (symbol === '^MERV') return 'MERVAL (USD CCL)'
  return symbol
}
