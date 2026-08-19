/**
 * Where a snapshot series came from.
 *
 * Migration 033 added portfolio_snapshots.source ('live' | 'estimated') so a
 * reconstructed day could be told apart from a measured one, and then nothing
 * read it: the historical backfill wrote 71 estimated rows that reach the user
 * fused inside Max Drawdown, Sharpe and annualized volatility, with nothing on
 * screen saying so.
 *
 * All three questions — how many, which spans, what to render — live here so
 * the rule for interpreting `source` exists exactly once.
 *
 * WORKER-SAFE: no imports at all. Nothing here reaches into src/components,
 * which is why the input type is declared locally rather than imported from a
 * component's props or from PortfolioSnapshot.
 */

/** The minimum shape every function here needs. Callers satisfy it structurally. */
export interface DatedSourcePoint {
  snapshot_date: string
  source?: 'live' | 'estimated'
}

export interface SeriesProvenance {
  totalDays: number
  liveDays: number
  estimatedDays: number
  /** true when any day in the series is reconstructed */
  hasEstimated: boolean
  /** YYYY-MM-DD, null on an empty series */
  firstDate: string | null
  lastDate: string | null
}

/**
 * A row with NO source counts as live.
 *
 * Not a guess: migration 033 declares the column `not null default 'live'`
 * precisely because every row that predates the backfill is a real observation.
 * Treating an absent value as unknown would invent a third state the database
 * cannot produce.
 */
export function isEstimated(point: DatedSourcePoint): boolean {
  return point.source === 'estimated'
}

export function summarizeProvenance(points: DatedSourcePoint[]): SeriesProvenance {
  let estimatedDays = 0
  for (const point of points) {
    if (isEstimated(point)) estimatedDays++
  }

  const totalDays = points.length

  return {
    totalDays,
    liveDays: totalDays - estimatedDays,
    estimatedDays,
    hasEstimated: estimatedDays > 0,
    // Read off the ends, NOT re-sorted: fetchSnapshotSeries guarantees ascending
    // order, and quietly re-sorting here would mask a caller that broke it.
    firstDate: totalDays > 0 ? points[0].snapshot_date : null,
    lastDate: totalDays > 0 ? points[totalDays - 1].snapshot_date : null,
  }
}

/**
 * Contiguous runs of reconstructed days, for the chart's shaded background.
 *
 * Today the reconstructed span is single and contiguous (2026-04-10 … 2026-07-22,
 * then live), so one range comes back. Interleaved runs are handled anyway,
 * because the day one appears nobody will be watching for it. A single-day run
 * yields from === to, which Recharts renders as a hairline band.
 */
export function estimatedRanges(
  points: DatedSourcePoint[]
): Array<{ from: string; to: string }> {
  const ranges: Array<{ from: string; to: string }> = []
  let open: { from: string; to: string } | null = null

  for (const point of points) {
    if (isEstimated(point)) {
      if (open) open.to = point.snapshot_date
      else open = { from: point.snapshot_date, to: point.snapshot_date }
    } else if (open) {
      ranges.push(open)
      open = null
    }
  }

  if (open) ranges.push(open)

  return ranges
}

/**
 * The line to render under a metric, and its tone. Null means render nothing.
 *
 * The copy and the tone decision live here rather than in the component because
 * the repo has no @testing-library/react and not a single .tsx test — only
 * jsdom. A pure function keeps both testable without adding that stack, and
 * leaves ProvenanceNote a dumb renderer.
 */
export function provenanceLabel(
  provenance: SeriesProvenance | undefined
): { text: string; tone: 'muted' | 'warn' } | null {
  // Absent when a caller has no series to describe. Every statistics route
  // sends a provenance block today — /api/statistics/ons has done so since
  // it started computing over the ons universe — so this is the guard for a
  // caller that omits it, not a statement about any particular tab.
  if (!provenance || provenance.totalDays === 0) return null

  if (provenance.hasEstimated) {
    return {
      text: `${provenance.totalDays} días · ${provenance.estimatedDays} reconstruidos`,
      tone: 'warn',
    }
  }

  return { text: `${provenance.totalDays} días medidos`, tone: 'muted' }
}
