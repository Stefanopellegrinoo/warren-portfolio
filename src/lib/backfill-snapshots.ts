// src/lib/backfill-snapshots.ts
/**
 * Composes the reconstructed snapshot rows for one user.
 *
 * Pure: no DB, no network. Takes the user's full history plus a per-ticker bar
 * cache and returns one row per market day. Valuation is delegated to
 * buildSnapshotRow — the SAME function the daily job uses — so a reconstructed
 * row and a measured row can never mean two different things.
 *
 * The four H4 failure modes this deliberately does not repeat: no active-ticker
 * filter (a position sold in 2023 is valued on every 2022 day it was held);
 * ONs and cash are included; a day with no bar is marked at avg_cost via
 * applyCostFallback and NEVER at 0; and a Yahoo failure aborts upstream in
 * fetchDailyBars rather than arriving here disguised as a missing price.
 *
 * WORKER-SAFE: relative value imports only.
 */
import type { Quote } from '@/types'
import { buildSnapshotRow, type SnapshotRow } from './portfolio-snapshots'
import { closeOnOrBefore, buildQuoteMap, type DailyBar } from './historical-prices'
import { replayPortfolioAt, type ReplayMovement, type ReplayTransaction } from './portfolio-replay'

export interface BackfillDay {
  row: SnapshotRow & { source: 'estimated' }
  unpricedTickers: string[]
  /**
   * Every ticker HELD that day, priced or not — stocks then ONs.
   *
   * The denominator the dry-run report needs. Counting unpriced days against
   * the total length of the backfill understates severity on nearly every line:
   * a ticker held 50 of 1120 days and unpriced on all 50 prints "50 of 1120",
   * which reads as a 4% problem and is a 100% pricing failure for that
   * position's entire life. Only this function knows which tickers were held.
   */
  heldTickers: string[]
}

export interface BackfillInput {
  userId: string
  transactions: ReplayTransaction[]
  movements: ReplayMovement[]
  dates: string[]
  barsByTicker: Map<string, DailyBar[]>
  /**
   * Accept a replayed cash balance that goes materially negative.
   *
   * A conscious override, not a convenience: see the funding-side guard below
   * for what the resulting series actually measures.
   */
  allowNegativeCash?: boolean
}

/**
 * How far below zero the replayed cash balance may legitimately sit, in USD.
 *
 * `cash_movements.amount` is numeric(18,4) and every write rounds, so a fully
 * invested day can land a hair under zero without anything being wrong — and a
 * 1120-day build must not abort over a rounding cent. One dollar sits orders of
 * magnitude above that noise and orders of magnitude below a real funding gap
 * (the one measured on this DB is six figures), so it can neither be tripped by
 * a cent nor hide a missing deposit.
 */
const NEGATIVE_CASH_TOLERANCE = 1

/** The sorted union of every bar date inside [from, to] — the market calendar. */
export function marketDaysFrom(
  barsByTicker: Map<string, DailyBar[]>,
  from: string,
  to: string
): string[] {
  const days = new Set<string>()
  barsByTicker.forEach(bars => {
    for (const bar of bars) {
      if (bar.date >= from && bar.date <= to) days.add(bar.date)
    }
  })
  return Array.from(days).sort()
}

export function buildBackfillRows(input: BackfillInput): BackfillDay[] {
  const { userId, transactions, movements, dates, barsByTicker, allowNegativeCash = false } = input

  // Index the caller's bars by NORMALIZED key, once for the whole run.
  //
  // The lookup ticker cannot be normalized into a match: replayPortfolioAt
  // already returns trimmed-uppercase tickers, so re-normalizing it is a no-op.
  // The mismatch can only live on the map's side, so that is the side to fix.
  // A miss here is SILENT and TOTAL — every position on every day falls to
  // avg_cost and the series comes out flat, plausible and invented — and this
  // repo has written malformed ticker strings before.
  const barsByNormalizedTicker = new Map<string, DailyBar[]>()
  barsByTicker.forEach((bars, ticker) => {
    barsByNormalizedTicker.set(String(ticker).trim().toUpperCase(), bars)
  })

  // The worst day the replayed cash balance reaches over the requested range.
  // Evaluated after the whole series is built so the message names the WORST
  // day rather than the first one — see the funding-side guard below.
  let worstCash = 0
  let worstCashDate: string | null = null

  const days = dates.map(date => {
    const state = replayPortfolioAt(transactions, movements, date)

    if (state.cashBalance < worstCash) {
      worstCash = state.cashBalance
      worstCashDate = date
    }

    // Price only what was held that day. A ticker with no bar on or before the
    // date is simply absent from the map — applyCostFallback then marks it at
    // its own avg_cost inside buildSnapshotRow.
    const prices = new Map<string, number>()
    for (const position of state.positions) {
      const close = closeOnOrBefore(barsByNormalizedTicker.get(position.ticker) ?? [], date)
      if (close !== null) prices.set(position.ticker, close)
    }

    const stockQuotes = buildQuoteMap(prices)
    // ONs have no historical source at all — Data912 is spot-only. They go in
    // with an empty quote map and are marked at cost by the same rule.
    const onQuotes = new Map<string, Quote>()

    const row = buildSnapshotRow(
      {
        userId,
        positions: state.positions as any[],
        onPositions: state.onPositions as any[],
        // Verified: the four snapshot fields never read realized P&L
        // (portfolio-engine.ts:240-253), so closed_trades needs no replay.
        realized: 0,
        onRealized: 0,
        cashBalance: state.cashBalance,
      },
      stockQuotes,
      onQuotes,
      date
    )

    const heldTickers = [
      ...state.positions.map(p => p.ticker),
      ...state.onPositions.map(p => p.ticker),
    ]

    const unpricedTickers = [
      ...state.positions.filter(p => !stockQuotes.has(p.ticker)).map(p => p.ticker),
      ...state.onPositions.map(p => p.ticker),
    ]

    // applyCostFallback leaves a position out of the quote map entirely when it
    // has NO price AND no usable cost (portfolio-valuation.ts:46), and the
    // summary then drops it from total_value AND total_invested together
    // (portfolio-engine.ts:226-228). Over a long series that reads as a drop on
    // the days it vanishes and a recovery on the days it does not — exactly the
    // shape Max Drawdown is built to detect. This module cannot fix that rule
    // (it is shared with the live daily job) but it holds both halves of the
    // predicate, so it can refuse to emit the row. unpricedTickers alone is not
    // a usable signal: on early days that list is long and legitimate, and a
    // vanished position hides inside it.
    const vanished = [...state.positions, ...state.onPositions].filter(
      p => !stockQuotes.has(p.ticker) && !(Number(p.avg_cost) > 0)
    )
    if (vanished.length > 0) {
      throw new Error(
        `[Backfill] ${date}: position(s) with no price and no usable cost would be dropped from both value and invested: ${vanished.map(p => p.ticker).join(', ')}`
      )
    }

    return { row: { ...row, source: 'estimated' as const }, unpricedTickers, heldTickers }
  })

  // ── The funding-side guard ────────────────────────────────────────────────
  //
  // An imported ledger holds the buys but not the deposits that funded them.
  // Each COMPRA then debits cash by exactly its own cost with nothing crediting
  // it, the two legs cancel, and total_value stops being portfolio value: it
  // degenerates into cumulative P&L on a near-zero base. Measured on this DB the
  // reconstructed series runs 0.00 → 682 → 6,276 → 28,757 across 2022-2026 and
  // then jumps to 425,626 when the reconciling deposits finally land at the END
  // of the range — plausible, monotonic, and entirely invented.
  //
  // Nothing downstream catches it. computeFlowAdjustedReturns only gaps an
  // interval whose startValue is <= 0, and $682 is positive; the per-user
  // reconciliation gate validates TODAY, which reconciles correctly precisely
  // because the missing deposits were booked at the end. This function already
  // computes every day's state, so it is the only place that can see it — and
  // these rows become the permanent source for Max Drawdown, volatility and
  // Sharpe, so it refuses the WHOLE build rather than emitting a partial series.
  if (!allowNegativeCash && worstCashDate !== null && worstCash < -NEGATIVE_CASH_TOLERANCE) {
    throw new Error(
      `[Backfill] replayed cash goes negative — worst on ${worstCashDate} at ${worstCash.toFixed(2)}. ` +
        'The ledger holds the buys but not the deposits that funded them, so total_value is ' +
        'cumulative P&L on a near-zero base, not portfolio value — and Max Drawdown, volatility ' +
        'and Sharpe would be computed from it permanently. Narrow the reconstructed range with ' +
        '--from so it starts after the funding is actually in place, or re-date the reconciling ' +
        'cash movements to before the first transaction — adjustCashBalance / POST /api/cash/adjust ' +
        "reconciles the TOTAL, not when it lands, so it cannot fix this if today's balance is " +
        'already correct. Or pass allowNegativeCash / --allow-negative-cash to accept it deliberately.'
    )
  }

  return days
}
