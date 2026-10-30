/**
 * Statement amounts to US dollars at each period end's rate (odd/tasks/asset-page.md T2, S5 S7).
 *
 * ARS uses the app's CCL history (fx_rates, read-only), as the user chose; any other currency
 * uses Yahoo's `XXX=X` daily closes. Both are units per dollar, so USD = amount / rate.
 */
import { getHistoricalCCL } from '../currency'
import { fetchDailyBars, toUsd, type DailyBar } from '../historical-prices'
import type { Series } from './types'

export interface FxDeps {
  /** ARS per dollar by date, from a date to today. */
  getCcl?: (from: Date) => Promise<Map<string, number>>
  /** Daily closes of a Yahoo symbol. */
  getBars?: (symbol: string, from: Date, to: Date) => Promise<DailyBar[]>
}

/** A period may end on a weekend or holiday: start early enough to hold the rate on or before it. */
const LOOKBACK_DAYS = 10

/**
 * Units of `currency` per dollar by date, from `from` (the earliest period end, YYYY-MM-DD) to
 * today; null for USD, which needs none. One range read per company. Throws when the source
 * fails, so the caller keeps its last good data instead of an empty conversion.
 */
export async function fetchUsdRates(currency: string, from: string, deps: FxDeps = {}): Promise<Map<string, number> | null> {
  if (currency === 'USD') return null
  const start = new Date(from)
  start.setUTCDate(start.getUTCDate() - LOOKBACK_DAYS)
  if (currency === 'ARS') return (deps.getCcl ?? getHistoricalCCL)(start)
  const bars = await (deps.getBars ?? fetchDailyBars)(`${currency}=X`, start, new Date())
  return new Map(bars.map(b => [b.date, b.close]))
}

/**
 * Each point at the rate on or before its period end; null rates mean the series is already USD.
 * A point with no rate is dropped and flags `degraded`, as toUsd does for prices: never an invented rate.
 */
export function seriesToUsd(series: Series, rates: Map<string, number> | null): { series: Series; degraded: boolean } {
  if (!rates) return { series, degraded: false }
  const { bars, degraded } = toUsd(series.map(p => ({ date: p.end, close: p.value })), rates)
  return { series: bars.map(b => ({ end: b.date, value: b.close })), degraded }
}
