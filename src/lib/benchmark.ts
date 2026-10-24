/**
 * Portfolio TWR vs one market benchmark, both as cumulative % from a shared start.
 * The portfolio side is the flow-adjusted TWR (twr-series.ts) — never raw value,
 * which would read every deposit as outperformance.
 */
import { closeOnOrBefore, type DailyBar } from './historical-prices'
import { getBars } from './bars-cache'
import { getHistoricalCCL } from './currency'
import type { TwrPoint } from './twr-series'

export const BENCHMARKS = {
  SPY: { label: 'S&P 500 (SPY)', symbol: 'SPY', inArs: false },
  QQQ: { label: 'Nasdaq 100 (QQQ)', symbol: 'QQQ', inArs: false },
  MERV_CCL: { label: 'MERVAL (USD CCL)', symbol: '^MERV', inArs: true },
} as const
export type BenchmarkId = keyof typeof BENCHMARKS

export function isBenchmarkId(v: string): v is BenchmarkId {
  return Object.prototype.hasOwnProperty.call(BENCHMARKS, v)
}

export interface BenchmarkPoint { date: string; portfolioPct: number; benchmarkPct: number }
export interface BenchmarkComparison {
  id: BenchmarkId
  label: string
  points: BenchmarkPoint[]
  /** Portfolio cumulative TWR % minus benchmark cumulative %, in percentage points. */
  excessPp: number
}

/**
 * Pure. `ccl` (ARS per USD) makes `bars` ARS-denominated: each close is divided by
 * that day's CCL. Both sides carry forward over non-trading days. The series starts
 * at the first date where the benchmark (and CCL) exist; null if there is none.
 */
export function compareToBenchmark(
  twr: TwrPoint[],
  bars: DailyBar[],
  ccl?: DailyBar[]
): Pick<BenchmarkComparison, 'points' | 'excessPp'> | null {
  const aligned: { date: string; index: number; bench: number }[] = []
  for (const p of twr) {
    const close = closeOnOrBefore(bars, p.date)
    const rate = ccl ? closeOnOrBefore(ccl, p.date) : 1
    if (close === null || rate === null || !(rate > 0)) continue
    aligned.push({ date: p.date, index: p.twrIndex, bench: close / rate })
  }
  if (aligned.length === 0) return null

  const base = aligned[0]
  const points = aligned.map((a) => ({
    date: a.date,
    portfolioPct: (a.index / base.index - 1) * 100,
    benchmarkPct: (a.bench / base.bench - 1) * 100,
  }))
  const last = points[points.length - 1]
  return { points, excessPp: last.portfolioPct - last.benchmarkPct }
}

const DAY_MS = 86_400_000
/** Today's bar still moves: a cached chart is reused only as long as the statistics route caches its answer. */
const BARS_MAX_AGE_SEC = 300

/** Throws when there is no data (Yahoo failed and nothing is cached) — the caller turns that into an error flag. */
export async function fetchBenchmarkComparison(
  id: BenchmarkId,
  twr: TwrPoint[]
): Promise<BenchmarkComparison | null> {
  if (twr.length === 0) return null
  const { label, symbol, inArs } = BENCHMARKS[id]
  // 10 days of lead-in so the first TWR date (maybe a weekend) can carry a close forward.
  const from = new Date(new Date(twr[0].date).getTime() - 10 * DAY_MS)
  const to = new Date()

  // The daily bars cache the holdings use, kept fresh for 5 minutes instead of all day.
  const [charts, rates] = await Promise.all([
    getBars([symbol], from, { maxAgeSec: BARS_MAX_AGE_SEC }),
    inArs ? getHistoricalCCL(from, to) : null,
  ])
  const entry = charts.get(symbol)
  const bars = entry?.bars ?? []
  if (bars.length === 0) throw new Error(`No benchmark data for ${symbol}`)
  // Bars served stale after a Yahoo failure (up to days old) are not today's benchmark: the route flags it.
  if (entry?.degraded) throw new Error(`Stale benchmark data for ${symbol}`)

  let ccl: DailyBar[] | undefined
  if (rates) {
    if (rates.size === 0) throw new Error('No historical CCL available')
    ccl = [...rates].map(([date, close]) => ({ date, close: Number(close) }))
  }

  const cmp = compareToBenchmark(twr, bars, ccl)
  return cmp && { id, label, ...cmp }
}
