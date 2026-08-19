/**
 * Canonical portfolio valuation.
 *
 * Single-sources the missing-quote rule promoted from the private
 * withCostFallback in portfolio-snapshots.ts: a held ticker with no quote or a
 * quote priced <= 0 is valued at its own average cost — a conservative mark
 * that reports zero P&L, NEVER a fabricated -100% loss.
 *
 * WORKER-SAFE: imported (via portfolio-snapshots.ts) by the BullMQ worker,
 * which runs under tsx outside the Next build. Value imports MUST be relative;
 * `import type` from '@/types' is erased at compile time and is the
 * established pattern (see portfolio-snapshots.ts).
 */
import type { ONPosition, Position, PortfolioSummary, Quote } from '@/types'
import { calculatePortfolioSummary } from './portfolio-engine'

export interface CostFallbackResult {
  quotes: Map<string, Quote>
  unpricedCount: number
  unpricedTickers: string[]
}

/**
 * The single implementation of the missing-quote rule.
 *
 * A quote priced at 0/null counts as "no price": the engine treats a falsy
 * price as unpriced and drops the position from value AND invested, which
 * would understate a snapshot exactly like a missing quote does. A position
 * with no usable cost either is left out of the map but still counted, so the
 * gap is surfaced rather than hidden.
 */
export function applyCostFallback(
  positions: Array<{ ticker: string; avg_cost: number }>,
  quotes: Map<string, Quote>
): CostFallbackResult {
  const effective = new Map(quotes)
  const unpricedTickers: string[] = []

  for (const pos of positions) {
    const quoted = Number(effective.get(pos.ticker)?.price)
    if (quoted > 0) continue

    unpricedTickers.push(pos.ticker)

    const cost = Number(pos.avg_cost)
    if (!(cost > 0)) continue // no price and no usable cost — leave it out
    effective.set(pos.ticker, {
      ticker: pos.ticker,
      price: cost,
      change: 0,
      changePercent: 0,
      previousClose: cost,
    })
  }

  return { quotes: effective, unpricedCount: unpricedTickers.length, unpricedTickers }
}

/**
 * Splits a flat quote map into stock and ON quotes.
 *
 * Membership comes from the ON tables (`ons` / `on_positions`), NEVER from the
 * ticker name. Every ON ends in D, but the converse is false — JD, AMD and GOLD
 * are CEDEARs. Classifying by suffix routed those to the ON bucket, which left
 * the engine without a stock price for them and silently dropped both their
 * market value and their invested amount from the portfolio totals.
 */
export function splitQuotesByAssetClass(
  all: Map<string, Quote>,
  onTickers: Iterable<string>
) {
  const onSet = new Set(Array.from(onTickers, t => String(t).toUpperCase().trim()))
  const stockQuotes = new Map<string, Quote>()
  const onQuotes = new Map<string, Quote>()

  all.forEach((quote, ticker) => {
    if (onSet.has(String(ticker).toUpperCase().trim())) {
      onQuotes.set(ticker, quote)
    } else {
      stockQuotes.set(ticker, quote)
    }
  })

  return { stockQuotes, onQuotes }
}

export type MissingQuotePolicy = 'avg_cost' | 'drop'

export type PortfolioQuotes =
  | Map<string, Quote>
  | { stockQuotes: Map<string, Quote>; onQuotes: Map<string, Quote> }

export interface PortfolioValuationInputs {
  positions: Position[]
  onPositions: ONPosition[]
  cashBalance: number
  realized: number
  onRealized: number
}

export interface PortfolioValuation {
  positions: Position[]
  onPositions: ONPosition[]
  summary: PortfolioSummary
  unpricedCount: number
  unpricedTickers: string[]
}

/**
 * The single summary entry. Every calculatePortfolioSummary call site goes
 * through here with an explicit missing-quote policy:
 *
 *  - 'avg_cost' — snapshots and the history live point. Unpriced positions
 *    are marked at their own average cost (never 0, never dropped).
 *  - 'drop' — dashboard / worker summary. Quotes pass through UNTOUCHED, so
 *    unpriced positions fall out of the totals exactly as they always have —
 *    no displayed dashboard number changes. unpricedCount is still surfaced
 *    for a future badge.
 *
 * Accepts either one flat quote map (split by ON-position membership via
 * splitQuotesByAssetClass) or pre-split maps (dashboard/worker, whose stock
 * and ON quotes come from different providers).
 */
export function valuePortfolio(
  inputs: PortfolioValuationInputs,
  quotes: PortfolioQuotes,
  opts: { missingQuotePolicy: MissingQuotePolicy }
): PortfolioValuation {
  const { stockQuotes, onQuotes } =
    quotes instanceof Map
      ? splitQuotesByAssetClass(quotes, inputs.onPositions.map(p => p.ticker))
      : quotes

  const stockFallback = applyCostFallback(inputs.positions, stockQuotes)
  const onFallback = applyCostFallback(inputs.onPositions, onQuotes)

  const useFallback = opts.missingQuotePolicy === 'avg_cost'
  const { positions, onPositions, summary } = calculatePortfolioSummary(
    inputs.positions,
    inputs.onPositions,
    useFallback ? stockFallback.quotes : stockQuotes,
    useFallback ? onFallback.quotes : onQuotes,
    inputs.cashBalance,
    inputs.realized,
    inputs.onRealized
  )

  return {
    positions,
    onPositions,
    summary,
    unpricedCount: stockFallback.unpricedCount + onFallback.unpricedCount,
    unpricedTickers: [...stockFallback.unpricedTickers, ...onFallback.unpricedTickers],
  }
}
