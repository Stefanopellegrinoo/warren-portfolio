/**
 * Canonical portfolio valuation: ONE rule for a held position's price (odd/tasks/nucleo-ledger.md
 * S3, `markPrice` in ledger-now.ts): the live quote if positive, else the last close, else the
 * position's own average cost — never 0, never dropped, never a fabricated -100% loss.
 *
 * WORKER-SAFE: imported by the BullMQ worker, which runs under tsx outside the Next build.
 * Value imports MUST be relative; `import type` from '@/types' is erased at compile time.
 */
import type { ONPosition, Position, PortfolioSummary, Quote } from '@/types'
import { calculatePortfolioSummary } from './portfolio-engine'
import { markPrice } from './ledger-now'

export interface ValuationRuleResult {
  quotes: Map<string, Quote>
  unpricedCount: number
  unpricedTickers: string[]
}

/**
 * Applies the valuation rule to a quote map. A position without a live quote (none, or
 * priced <= 0) gets a neutral synthetic quote at its last close, else its cost, and is
 * counted as unpriced. One with no usable price at all is left out but still counted, so
 * the gap is surfaced rather than hidden. The caller's map is never mutated.
 */
export function applyValuationRule(
  positions: Array<{ ticker: string; avg_cost: number }>,
  quotes: Map<string, Quote>,
  lastCloses: Map<string, number> = new Map()
): ValuationRuleResult {
  const effective = new Map(quotes)
  const unpricedTickers: string[] = []

  for (const pos of positions) {
    if (Number(effective.get(pos.ticker)?.price) > 0) continue

    unpricedTickers.push(pos.ticker)

    const price = markPrice(null, lastCloses.get(pos.ticker), Number(pos.avg_cost))
    if (!(price > 0)) continue // no price and no usable cost — leave it out
    effective.set(pos.ticker, { ticker: pos.ticker, price, change: 0, changePercent: 0, previousClose: price })
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
 * The single summary entry. Accepts either one flat quote map (split by ON-position
 * membership via splitQuotesByAssetClass) or pre-split maps (dashboard/worker, whose stock
 * and ON quotes come from different providers). `lastCloses` (ticker → last close) is the
 * rule's middle tier for positions without a live quote.
 */
export function valuePortfolio(
  inputs: PortfolioValuationInputs,
  quotes: PortfolioQuotes,
  lastCloses: Map<string, number> = new Map()
): PortfolioValuation {
  const { stockQuotes, onQuotes } =
    quotes instanceof Map
      ? splitQuotesByAssetClass(quotes, inputs.onPositions.map(p => p.ticker))
      : quotes

  const stock = applyValuationRule(inputs.positions, stockQuotes, lastCloses)
  const on = applyValuationRule(inputs.onPositions, onQuotes, lastCloses)

  const { positions, onPositions, summary } = calculatePortfolioSummary(
    inputs.positions,
    inputs.onPositions,
    stock.quotes,
    on.quotes,
    inputs.cashBalance,
    inputs.realized,
    inputs.onRealized
  )

  return {
    positions,
    onPositions,
    summary,
    unpricedCount: stock.unpricedCount + on.unpricedCount,
    unpricedTickers: [...stock.unpricedTickers, ...on.unpricedTickers],
  }
}
