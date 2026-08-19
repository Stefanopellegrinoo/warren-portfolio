/**
 * Volatility and Sharpe over the portfolio's flow-adjusted return series.
 *
 * The old page computed both from MONTHLY REALIZED P&L IN DOLLARS — no
 * unrealized P&L, months without a closed trade silently missing, Sharpe not
 * annualized, and "Volatilidad Anual" formatted as USD. Neither number was
 * what its label promised.
 *
 * The correct input already existed: the flow-adjusted interval returns built
 * from portfolio_snapshots for the max drawdown (src/lib/drawdown.ts). These
 * are (business-)daily returns, so both figures annualize with √252.
 */

export interface ReturnStats {
  /** Annualized volatility as a FRACTION (0.18 = 18%); null under 2 returns. */
  annualizedVol: number | null
  /** Annualized Sharpe (rf = 0); null under 2 returns or zero variance. */
  sharpeRatio: number | null
  /** How many interval returns the figures rest on. */
  intervals: number
}

const PERIODS_PER_YEAR = 252

export function computeReturnStats(returns: number[]): ReturnStats {
  const n = returns.length
  if (n < 2) {
    return { annualizedVol: null, sharpeRatio: null, intervals: n }
  }

  const mean = returns.reduce((s, r) => s + r, 0) / n
  const variance =
    returns.reduce((s, r) => s + (r - mean) * (r - mean), 0) / (n - 1)
  const stdDev = Math.sqrt(variance)

  const annualizedVol = stdDev * Math.sqrt(PERIODS_PER_YEAR)
  const sharpeRatio = stdDev > 0 ? (mean / stdDev) * Math.sqrt(PERIODS_PER_YEAR) : null

  return { annualizedVol, sharpeRatio, intervals: n }
}
