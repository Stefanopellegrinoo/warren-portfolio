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

/** A split event: `numerator` new shares per `denominator` old ones, on `date`. */
export interface SplitEvent {
  /** YYYY-MM-DD */
  date: string
  numerator: number
  denominator: number
}

export interface DailyChart {
  bars: DailyBar[]
  splits: SplitEvent[]
  /** false when the answer came from historical(), which carries no split events. */
  splitsKnown: boolean
}

function normalizeSplits(rows: any[]): SplitEvent[] {
  return (rows ?? [])
    .filter(r => r?.date && Number(r.numerator) > 0 && Number(r.denominator) > 0)
    .map(r => ({
      date: new Date(r.date).toISOString().slice(0, 10),
      numerator: Number(r.numerator),
      denominator: Number(r.denominator),
    }))
}

/**
 * Daily bars for `symbol` over [from, to], plus the split events of the window.
 *
 * Throws HistoricalFetchError when BOTH endpoints fail. Returns empty bars only
 * when they both succeed and Yahoo has nothing — the distinction the caller needs
 * to tell "no such data" from "the network is angry".
 */
export async function fetchDailyChart(
  symbol: string,
  from: Date,
  to: Date,
  deps: { getYahoo?: () => Promise<any> } = {}
): Promise<DailyChart> {
  const getYahoo = deps.getYahoo ?? defaultGetYahoo
  const yf = await getYahoo()

  let chartFailure: unknown = null
  try {
    const res = await yf.chart(symbol, { period1: from, period2: to, interval: '1d' })
    const bars = normalizeBars(res?.quotes ?? [])
    // Decide on USABLE bars, not on the raw array: a non-empty response whose
    // closes are all null must still fall through to the legacy endpoint, or
    // [] would stop meaning "Yahoo genuinely has no bars".
    if (bars.length > 0) return { bars, splits: normalizeSplits(res?.events?.splits), splitsKnown: true }
  } catch (err) {
    chartFailure = err
  }

  // chart() gave nothing usable. Either it threw, or the symbol has no bars there.
  // The legacy endpoint settles which — it is the same one the app already uses.
  try {
    const rows = await yf.historical(symbol, { period1: from, period2: to, interval: '1d' })
    const bars = normalizeBars(rows ?? [])
    // [] is a fact only when chart() itself answered cleanly; after a chart() failure it is just "unknown".
    return { bars, splits: [], splitsKnown: bars.length === 0 && chartFailure === null }
  } catch (err) {
    throw new HistoricalFetchError(symbol, chartFailure ?? err)
  }
}

/** Bars only — see fetchDailyChart for the failure contract. */
export async function fetchDailyBars(
  symbol: string,
  from: Date,
  to: Date,
  deps: { getYahoo?: () => Promise<any> } = {}
): Promise<DailyBar[]> {
  return (await fetchDailyChart(symbol, from, to, deps)).bars
}

/**
 * Undoes Yahoo's split adjustment: chart() closes are retroactively divided by
 * every later split, but quantities in the ledger are as-traded. A bar dated
 * before a split is multiplied back by numerator/denominator of each later split.
 */
export function unadjustSplits(bars: DailyBar[], splits: SplitEvent[]): DailyBar[] {
  if (splits.length === 0) return bars
  return bars.map(bar => {
    const factor = splits
      .filter(s => s.date > bar.date)
      .reduce((acc, s) => acc * (s.numerator / s.denominator), 1)
    return factor === 1 ? bar : { date: bar.date, close: bar.close * factor }
  })
}

/**
 * ARS closes (.BA symbols) to USD at the CCL of the day, carrying the last
 * known rate forward. A bar with no CCL on or before it is DROPPED (the previous
 * price then carries forward in closeOnOrBefore) and the result is flagged
 * degraded — never converted at an invented rate.
 */
export function toUsd(bars: DailyBar[], ccl: Map<string, number>): { bars: DailyBar[]; degraded: boolean } {
  const rates: DailyBar[] = Array.from(ccl, ([date, close]) => ({ date, close }))
  let degraded = false
  const out: DailyBar[] = []
  for (const bar of bars) {
    const rate = closeOnOrBefore(rates, bar.date)
    if (rate === null || !(rate > 0)) {
      degraded = true
      continue
    }
    out.push({ date: bar.date, close: bar.close / rate })
  }
  return { bars: out, degraded }
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
