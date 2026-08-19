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
 * S1 foundation: pure function + tests only, no endpoint or UI consumer yet
 * (Phase 2 wires it to the statistics/history surface).
 */
import {
  computeFlowAdjustedReturns,
  type ExternalFlow,
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
  flows: ExternalFlow[]
): TwrSeries {
  const { intervals, intervalsUsed, intervalsSkipped } = computeFlowAdjustedReturns(
    snapshots,
    flows
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
