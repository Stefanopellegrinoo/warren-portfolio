import type { Quote } from '@/types'
import { applyValuationRule } from './portfolio-valuation'

/**
 * Position valuation for the statistics endpoints.
 *
 * A position with no usable quote is marked at its OWN average cost — zero
 * P&L — never at zero value. Valuing at 0 fabricates a -100% loss: it drags
 * openPnl, elects the position as "biggest loser" and paints a fake crash in
 * every chart. The valuation rule is single-sourced in applyValuationRule
 * (portfolio-valuation.ts): live quote, else last close, else own cost (S3).
 */

interface PositionLike {
  ticker: string
  quantity: number
  avg_cost: number
  total_invested: number
}

export interface StatPosition {
  /** Display ticker with any legacy `EXCHANGE:` prefix stripped. */
  ticker: string
  fullTicker: string
  market_value: number
  pnl: number
  pnl_pct: number
  /** false = no usable quote; the position is marked at cost (zero P&L). */
  priced: boolean
}

export interface StatTotals {
  totalMarketValue: number
  openPnl: number
  /** How many positions were marked at cost — surfaced, never hidden. */
  unpricedCount: number
}

export function enrichPositionsForStats(
  positions: PositionLike[],
  quotes: Map<string, Quote>,
  lastCloses: Map<string, number> = new Map()
): { positions: StatPosition[]; totals: StatTotals } {
  // unpricedTickers doubles as the `priced` flag source, so the flag reflects
  // the ORIGINAL quotes, not the fallback.
  const { quotes: effective, unpricedCount, unpricedTickers } = applyValuationRule(positions, quotes, lastCloses)
  const unpriced = new Set(unpricedTickers)

  let totalMarketValue = 0
  let openPnl = 0

  const enriched: StatPosition[] = positions.map((pos) => {
    const price = Number(effective.get(pos.ticker)?.price)

    // No usable price at all (cost 0): the invested amount, which is then 0 too.
    const market_value = price > 0 ? price * pos.quantity : pos.total_invested
    const pnl = market_value - pos.total_invested

    totalMarketValue += market_value
    openPnl += pnl

    return {
      ticker: pos.ticker.split(':')[1] || pos.ticker,
      fullTicker: pos.ticker,
      market_value,
      pnl,
      pnl_pct: pos.total_invested > 0 ? pnl / pos.total_invested : 0,
      priced: !unpriced.has(pos.ticker),
    }
  })

  return { positions: enriched, totals: { totalMarketValue, openPnl, unpricedCount } }
}
