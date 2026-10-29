/**
 * Closed-trade statistics — the pure math behind the statistics endpoints.
 *
 * Extracted so every formula an investor reads has a hand-computed fixture
 * behind it. Two formulas were wrong for as long as the page existed:
 *
 * - "Profit factor" was |avgWin / avgLoss| — that is the PAYOFF RATIO. The
 *   profit factor is gross profit / gross loss: 9 wins of $10 against 1 loss
 *   of $100 is 0.9, not 0.1. And with zero losing trades the old code
 *   returned 0 — a perfect record rendered as the worst possible value.
 * - "Win rate" counted OPEN positions currently in the green while its own
 *   subtitle showed closed-trade counts. Here it is winners / closed trades.
 *
 * Monthly grouping slices the date STRING (close_date is a plain date):
 * new Date('2026-01-01') shifts to the previous month on any server west of
 * UTC, and these numbers must not depend on where the container runs.
 *
 * A "trade" here is one SALE (the ledger core's realized row), not a round trip,
 * and its holding days run from the position's first purchase (average cost, no
 * lots). A figure with nothing to measure is null, never 0.
 */

export interface ClosedTradeLike {
  pnl: number | null
  close_date: string
  days_held?: number | null
}

export interface MonthlyReturn {
  month: string
  pnl: number
  trades: number
}

export interface TradeStats {
  totalTrades: number
  winnersCount: number
  losersCount: number
  /** winners / total closed trades; null when there are no closed trades. */
  winRate: number | null
  /** null without a winning sale. */
  avgWin: number | null
  /** null without a losing sale. */
  avgLoss: number | null
  /** gross profit / gross loss; null when no losses (∞) or no trades. */
  profitFactor: number | null
  /** Days from the position's first purchase to the sale; null when no sale carries them. */
  avgHoldingDays: number | null
  maxHoldingDays: number | null
  minHoldingDays: number | null
  /** Every calendar month from the first sale to the last, 0 for a month without sales. */
  monthlyReturns: MonthlyReturn[]
}

export function computeTradeStats(trades: ClosedTradeLike[]): TradeStats {
  const pnls = trades.map((t) => Number(t.pnl) || 0)

  const winners = pnls.filter((p) => p > 0)
  const losers = pnls.filter((p) => p < 0)

  const grossProfit = winners.reduce((s, p) => s + p, 0)
  const grossLoss = losers.reduce((s, p) => s + p, 0) // negative sum

  const avgWin = winners.length > 0 ? grossProfit / winners.length : null
  const avgLoss = losers.length > 0 ? grossLoss / losers.length : null

  const profitFactor = grossLoss < 0 ? grossProfit / Math.abs(grossLoss) : null
  const winRate = trades.length > 0 ? winners.length / trades.length : null

  // Holding period — only over trades that actually carry days_held; a null
  // counted as 0 used to fake the minimum.
  const holdingDays = trades
    .map((t) => t.days_held)
    .filter((d): d is number => typeof d === 'number' && Number.isFinite(d))
  const avgHoldingDays =
    holdingDays.length > 0
      ? Math.round(holdingDays.reduce((s, d) => s + d, 0) / holdingDays.length)
      : null
  const maxHoldingDays = holdingDays.length > 0 ? Math.max(...holdingDays) : null
  const minHoldingDays = holdingDays.length > 0 ? Math.min(...holdingDays) : null

  // Monthly realized P&L — string slice, never new Date() (TZ-proof).
  const monthMap = new Map<string, { pnl: number; trades: number }>()
  for (const t of trades) {
    const month = String(t.close_date).slice(0, 7)
    const entry = monthMap.get(month) ?? { pnl: 0, trades: 0 }
    entry.pnl += Number(t.pnl) || 0
    entry.trades += 1
    monthMap.set(month, entry)
  }
  const months = Array.from(monthMap.keys()).sort()
  const monthlyReturns: MonthlyReturn[] = []
  for (let m = months[0]; m && m <= months[months.length - 1]; m = nextMonth(m)) {
    monthlyReturns.push({ month: m, ...(monthMap.get(m) ?? { pnl: 0, trades: 0 }) })
  }

  return {
    totalTrades: trades.length,
    winnersCount: winners.length,
    losersCount: losers.length,
    winRate,
    avgWin,
    avgLoss,
    profitFactor,
    avgHoldingDays,
    maxHoldingDays,
    minHoldingDays,
    monthlyReturns,
  }
}

/** 'YYYY-MM' → the following month, by string arithmetic (TZ-proof, like the grouping). */
function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}
