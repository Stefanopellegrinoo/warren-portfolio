/**
 * Max drawdown, adjusted for external cash flows.
 *
 * Raw peak-to-trough on `portfolio_snapshots.total_value` measures the wrong
 * thing: total_value includes cash, so a withdrawal reads as a loss and a
 * deposit inflates the peak. This module converts the snapshot series into a
 * return series that neutralises deposits and withdrawals, then measures the
 * drawdown of the compounded index.
 *
 * Per interval between consecutive snapshots:
 *
 *     r = (V_end - F) / V_start - 1
 *
 * where F is the NET external flow that landed inside that interval. Flows are
 * aggregated over the half-open interval (previous snapshot date, current
 * snapshot date], so movements on days with no snapshot — weekends, holidays,
 * a missed worker run — are still counted exactly once.
 *
 * IMPORTANT — what counts as an external flow is decided by the CALLER, and it
 * is not "type in (DEPOSITO, RETIRO)". Bulk-import RPCs write buys as RETIRO
 * and sells as DEPOSITO, so that predicate sweeps in internal reallocations.
 * See src/lib/cash-flows.ts.
 */

export interface SnapshotPoint {
  snapshot_date: string
  total_value: number
}

/** A net external movement. Positive = money in, negative = money out. */
export interface ExternalFlow {
  date: string
  amount: number
}

export interface DrawdownResult {
  /** Worst peak-to-trough decline as a ratio, always <= 0. */
  maxDrawdown: number
  intervalsUsed: number
  /** Intervals whose return was undefined — surfaced rather than guessed. */
  intervalsSkipped: number
}

export interface FlowAdjustedInterval {
  /** snapshot_date that closes the interval. */
  endDate: string
  /** Flow-adjusted simple return, or null when the interval was skipped. */
  r: number | null
}

export interface FlowAdjustedReturns {
  /** One flow-adjusted simple return per usable snapshot interval. */
  returns: number[]
  intervalsUsed: number
  /** Intervals whose return was undefined — surfaced rather than guessed. */
  intervalsSkipped: number
  /**
   * Every interval in order, usable or not, paired with its closing
   * snapshot_date. r is null for skipped intervals so consumers that need
   * date alignment (computeTwrSeries) can tell WHICH intervals were dropped.
   */
  intervals: FlowAdjustedInterval[]
}

export interface FlowAdjustedOptions {
  /**
   * Dates whose interval the CALLER declares it cannot interpret. The interval
   * spanning such a date is reported as a gap (r: null) instead of a return.
   *
   * This exists for events whose effect on the recorded value depends on
   * information the series does not carry. An ON coupon is the case that
   * motivated it: the payment leaves the bond, so a `−amount` flow is right
   * when the leg was priced and fabricates a gain the size of the coupon when
   * the leg fell back to cost (`missingQuotePolicy: 'avg_cost'`), which the
   * snapshot row does not record. A flow has to bet on one of those; a gap
   * does not. Losing ~2 intervals a year to semiannual coupons is the price.
   *
   * Flows falling inside a skipped interval are dropped WITH it — they are
   * already reflected in the value that opens the next one.
   */
  unmeasurableDates?: string[]
}

/**
 * The flow-adjusted return series itself. The drawdown compounds it; the
 * volatility/Sharpe statistics consume it directly — one series, one
 * definition of "portfolio return", everywhere.
 */
export function computeFlowAdjustedReturns(
  snapshots: SnapshotPoint[],
  flows: ExternalFlow[],
  options: FlowAdjustedOptions = {}
): FlowAdjustedReturns {
  const points = [...snapshots].sort((a, b) =>
    String(a.snapshot_date).localeCompare(String(b.snapshot_date))
  )

  if (points.length < 2) {
    return { returns: [], intervalsUsed: 0, intervalsSkipped: 0, intervals: [] }
  }

  const movements = [...flows].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const unmeasurable = [...(options.unmeasurableDates ?? [])].sort((a, b) =>
    String(a).localeCompare(String(b))
  )

  // Flows on or before the baseline are already reflected in the first value.
  let flowIdx = 0
  while (
    flowIdx < movements.length &&
    String(movements[flowIdx].date) <= String(points[0].snapshot_date)
  ) {
    flowIdx++
  }

  // Same for unmeasurable dates: one at or before the baseline closes no
  // interval, so there is nothing to skip.
  let skipIdx = 0
  while (
    skipIdx < unmeasurable.length &&
    String(unmeasurable[skipIdx]) <= String(points[0].snapshot_date)
  ) {
    skipIdx++
  }

  const returns: number[] = []
  const intervals: FlowAdjustedInterval[] = []
  let intervalsSkipped = 0

  for (let i = 1; i < points.length; i++) {
    const startValue = Number(points[i - 1].total_value)
    const endValue = Number(points[i].total_value)
    const boundary = String(points[i].snapshot_date)

    let netFlow = 0
    while (flowIdx < movements.length && String(movements[flowIdx].date) <= boundary) {
      netFlow += Number(movements[flowIdx].amount) || 0
      flowIdx++
    }

    // An interval the caller declared unmeasurable is a gap, whatever the
    // numbers say. Consuming the flows above first is deliberate: they belong
    // to this interval and go away with it rather than leaking into the next,
    // where they would be adjusted out of a move that never included them.
    let skipInterval = false
    while (skipIdx < unmeasurable.length && String(unmeasurable[skipIdx]) <= boundary) {
      skipInterval = true
      skipIdx++
    }
    if (skipInterval) {
      intervals.push({ endDate: boundary, r: null })
      intervalsSkipped++
      continue
    }

    // A return off a zero or negative base is meaningless, and so is one that
    // implies the portfolio ended at or below nothing. Both mean broken or
    // incomplete data far more often than a real total loss, so they are
    // reported as gaps instead of poisoning the series with a fake -100%.
    if (!(startValue > 0) || !Number.isFinite(endValue)) {
      intervals.push({ endDate: boundary, r: null })
      intervalsSkipped++
      continue
    }

    const factor = (endValue - netFlow) / startValue
    if (!(factor > 0) || !Number.isFinite(factor)) {
      intervals.push({ endDate: boundary, r: null })
      intervalsSkipped++
      continue
    }

    const r = factor - 1
    returns.push(r)
    intervals.push({ endDate: boundary, r })
  }

  return { returns, intervalsUsed: returns.length, intervalsSkipped, intervals }
}

export function computeFlowAdjustedMaxDrawdown(
  snapshots: SnapshotPoint[],
  flows: ExternalFlow[],
  options: FlowAdjustedOptions = {}
): DrawdownResult {
  const { returns, intervalsUsed, intervalsSkipped } = computeFlowAdjustedReturns(
    snapshots,
    flows,
    options
  )

  let index = 1
  let peak = 1
  let maxDrawdown = 0

  for (const r of returns) {
    index *= 1 + r
    if (index > peak) peak = index
    const drawdown = (index - peak) / peak
    if (drawdown < maxDrawdown) maxDrawdown = drawdown
  }

  return { maxDrawdown, intervalsUsed, intervalsSkipped }
}
