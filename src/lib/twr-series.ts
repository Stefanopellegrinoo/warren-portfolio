/**
 * Daily time-weighted return (TWR) series from portfolio snapshots.
 *
 * Reuses computeFlowAdjustedReturns — the SAME per-interval, flow-neutral
 * return series behind Max Drawdown, volatility and Sharpe — and links the
 * usable intervals geometrically into a cumulative index (start 1.0). Each
 * cumulative value is paired with the snapshot_date closing its interval;
 * skipped intervals are gaps in the series (surfaced via intervalsSkipped),
 * never zero-filled points.
 *
 * Consumed by benchmark.ts via /api/statistics?benchmark=.
 */
import {
  computeFlowAdjustedReturns,
  type ExternalFlow,
  type FlowAdjustedOptions,
  type SnapshotPoint,
} from './drawdown'

export interface TwrPoint {
  date: string
  /** Cumulative growth factor; 1.0 = the baseline snapshot. */
  twrIndex: number
  /** (twrIndex − 1) × 100 */
  twrPct: number
}

export interface TwrSeries {
  series: TwrPoint[]
  intervalsUsed: number
  intervalsSkipped: number
}

export function computeTwrSeries(
  snapshots: SnapshotPoint[],
  flows: ExternalFlow[],
  options: FlowAdjustedOptions = {}
): TwrSeries {
  const { intervals, intervalsUsed, intervalsSkipped } = computeFlowAdjustedReturns(
    snapshots,
    flows,
    options
  )

  if (intervals.length === 0) {
    return { series: [], intervalsUsed, intervalsSkipped }
  }

  const sorted = [...snapshots].sort((a, b) =>
    String(a.snapshot_date).localeCompare(String(b.snapshot_date))
  )

  // intervals[j] (0-based) opens at sorted[j] and closes at sorted[j + 1].
  // The baseline must anchor to the OPENING of the first USABLE interval,
  // not sorted[0] unconditionally — otherwise a skipped leading interval
  // (e.g. a broken zero snapshot) mis-dates the baseline to the opening of
  // an unmeasured interval, smearing the first real return across the gap.
  const firstUsableIndex = intervals.findIndex((interval) => interval.r !== null)
  if (firstUsableIndex === -1) {
    // Every interval was skipped — a lone, mis-dated baseline point would
    // convey nothing about performance.
    return { series: [], intervalsUsed, intervalsSkipped }
  }

  const series: TwrPoint[] = [
    { date: String(sorted[firstUsableIndex].snapshot_date), twrIndex: 1, twrPct: 0 },
  ]

  let index = 1
  for (const interval of intervals) {
    if (interval.r === null) continue // gap: surfaced via intervalsSkipped
    index *= 1 + interval.r
    series.push({ date: interval.endDate, twrIndex: index, twrPct: (index - 1) * 100 })
  }

  return { series, intervalsUsed, intervalsSkipped }
}

/**
 * The Mi cartera chart without a "today" that had no session (odd/tasks/day-change.md S4). The series
 * always ends with today at the live price; on a weekend or a holiday that is the last close again, so
 * the chart's last bar would read 0 %. Today goes on Saturdays and Sundays (Argentina's day) and on any
 * day it did not move from the last session; a lone point stays.
 */
export function dropIdleToday<P extends { date: string; twrIndex: number }>(points: P[], today: string): P[] {
  const last = points.at(-1)
  const prev = points.at(-2)
  if (!last || !prev || last.date !== today) return points
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay()
  const idle = weekday === 0 || weekday === 6 || Math.abs(last.twrIndex - prev.twrIndex) < 1e-12
  return idle ? points.slice(0, -1) : points
}
