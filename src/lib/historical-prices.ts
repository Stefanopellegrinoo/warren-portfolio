// src/lib/historical-prices.ts
/**
 * Historical daily bars for the snapshot backfill.
 *
 * WHY THIS EXISTS instead of fetchHistoricalQuotes: that function catches every
 * non-CCL error and returns [] (yahoo-finance.ts:426-430). For a chart that
 * degrades harmlessly. For a backfill it is fatal — a rate-limit would read as
 * "this ticker has no price", fall back to avg_cost, and fossilise an invented
 * flat line into the series that Max Drawdown is computed from. Here a
 * transport failure THROWS and an empty result means only one thing: Yahoo has
 * no bars for this symbol.
 *
 * WORKER-SAFE: value imports are relative; `import type` is erased.
 */
import type { Quote } from '@/types'

export interface DailyBar {
  /** YYYY-MM-DD */
  date: string
  close: number
}

export class HistoricalFetchError extends Error {
  readonly symbol: string

  constructor(symbol: string, cause: unknown) {
    super(`[Backfill] Historical fetch failed for ${symbol}: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'HistoricalFetchError'
    this.symbol = symbol
  }
}

let yahooInstance: any = null

async function defaultGetYahoo(): Promise<any> {
  if (yahooInstance) return yahooInstance
  const mod = await import('yahoo-finance2')
  const YF = (mod as any).default || mod
  const instance = typeof YF === 'function' ? new YF() : YF
  if (typeof instance.suppressNotices === 'function') instance.suppressNotices(['yahooSurvey'])
  yahooInstance = instance
  return instance
}

function toBar(row: any): DailyBar | null {
  // Number(null) coerces to 0, which Number.isFinite happily accepts — so the
  // null-check on the raw value must come first, or a genuinely missing close
  // silently becomes a priced zero (the exact H4 failure mode this module exists
  // to prevent).
  if (!row?.date || row.close === null || row.close === undefined) return null
  const close = Number(row.close)
  if (!Number.isFinite(close)) return null
  return { date: new Date(row.date).toISOString().slice(0, 10), close }
}

function normalizeBars(rows: any[]): DailyBar[] {
  return (rows ?? []).map(toBar).filter((b: DailyBar | null): b is DailyBar => b !== null)
}

/**
 * Daily bars for `symbol` over [from, to].
 *
 * Throws HistoricalFetchError when BOTH endpoints fail. Returns [] only when
 * they both succeed and Yahoo has nothing — the distinction the caller needs
 * to tell "no such data" from "the network is angry".
 */
export async function fetchDailyBars(
  symbol: string,
  from: Date,
  to: Date,
  deps: { getYahoo?: () => Promise<any> } = {}
): Promise<DailyBar[]> {
  const getYahoo = deps.getYahoo ?? defaultGetYahoo
  const yf = await getYahoo()

  let chartFailure: unknown = null
  try {
    const res = await yf.chart(symbol, { period1: from, period2: to, interval: '1d' })
    const bars = normalizeBars(res?.quotes ?? [])
    // Decide on USABLE bars, not on the raw array: a non-empty response whose
    // closes are all null must still fall through to the legacy endpoint, or
    // [] would stop meaning "Yahoo genuinely has no bars".
    if (bars.length > 0) return bars
  } catch (err) {
    chartFailure = err
  }

  // chart() gave nothing usable. Either it threw, or the symbol has no bars there.
  // The legacy endpoint settles which — it is the same one the app already uses.
  try {
    const rows = await yf.historical(symbol, { period1: from, period2: to, interval: '1d' })
    return normalizeBars(rows ?? [])
  } catch (err) {
    throw new HistoricalFetchError(symbol, chartFailure ?? err)
  }
}

/**
 * The close on `date`, else the most recent close before it.
 *
 * Carries the last price forward across weekends and holidays. Returns null —
 * never 0 — when the series starts after `date`, because a 0 would report a
 * -100% crash for every day before an ETF existed.
 */
export function closeOnOrBefore(bars: DailyBar[], date: string): number | null {
  let best: DailyBar | null = null
  for (const bar of bars) {
    if (bar.date <= date && (!best || bar.date > best.date)) best = bar
  }
  return best ? best.close : null
}

/** Wraps day-D prices in the Quote shape the valuation expects. */
export function buildQuoteMap(pricesByTicker: Map<string, number>): Map<string, Quote> {
  const quotes = new Map<string, Quote>()
  pricesByTicker.forEach((price, ticker) => {
    if (!(price > 0)) return
    quotes.set(ticker, { ticker, price, change: 0, changePercent: 0, previousClose: price })
  })
  return quotes
}
