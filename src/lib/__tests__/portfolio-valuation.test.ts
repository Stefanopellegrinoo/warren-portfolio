import { describe, it, expect } from 'vitest'
import type { Quote } from '@/types'
import { applyCostFallback, valuePortfolio } from '../portfolio-valuation'
import { calculatePortfolioSummary } from '../portfolio-engine'

// ── Helpers ──────────────────────────────────────────────────────────────────

function quote(ticker: string, price: number): Quote {
  return { ticker, price, change: 0, changePercent: 0, previousClose: price }
}

function position(ticker: string, quantity: number, avgCost: number) {
  return { ticker, quantity, avg_cost: avgCost, total_invested: quantity * avgCost }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('applyCostFallback', () => {
  it('leaves a priced position untouched and reports zero unpriced', () => {
    // Arrange
    const positions = [position('AAPL', 10, 15)]
    const quotes = new Map([['AAPL', quote('AAPL', 20)]])

    // Act
    const result = applyCostFallback(positions, quotes)

    // Assert
    expect(result.quotes.get('AAPL')?.price).toBe(20)
    expect(result.unpricedCount).toBe(0)
    expect(result.unpricedTickers).toEqual([])
  })

  it('marks a missing quote at avg_cost with a neutral synthetic quote', () => {
    // Arrange — no quote at all for the held ticker
    const positions = [position('AAPL', 10, 15)]
    const quotes = new Map<string, Quote>()

    // Act
    const result = applyCostFallback(positions, quotes)

    // Assert — priced at cost, zero day-change, counted and named
    expect(result.quotes.get('AAPL')).toEqual({
      ticker: 'AAPL',
      price: 15,
      change: 0,
      changePercent: 0,
      previousClose: 15,
    })
    expect(result.unpricedCount).toBe(1)
    expect(result.unpricedTickers).toEqual(['AAPL'])
  })

  it('treats a quote priced at 0 as "no price" and falls back to cost', () => {
    // Arrange — a 0/negative price is unpriced, not a worthless holding
    const positions = [position('AAPL', 10, 15)]
    const quotes = new Map([['AAPL', quote('AAPL', 0)]])

    // Act
    const result = applyCostFallback(positions, quotes)

    // Assert
    expect(result.quotes.get('AAPL')?.price).toBe(15)
    expect(result.unpricedCount).toBe(1)
    expect(result.unpricedTickers).toEqual(['AAPL'])
  })

  it('leaves out a position with no price AND no usable cost, but still counts it', () => {
    // Arrange — avg_cost 0 cannot produce a synthetic quote
    const positions = [position('GHOST', 5, 0)]
    const quotes = new Map<string, Quote>()

    // Act
    const result = applyCostFallback(positions, quotes)

    // Assert — no fabricated quote, but the gap is surfaced
    expect(result.quotes.has('GHOST')).toBe(false)
    expect(result.unpricedCount).toBe(1)
    expect(result.unpricedTickers).toEqual(['GHOST'])
  })

  it('never mutates the input quote map', () => {
    // Arrange
    const positions = [position('AAPL', 10, 15)]
    const quotes = new Map<string, Quote>()

    // Act
    applyCostFallback(positions, quotes)

    // Assert — caller's map untouched (immutability contract)
    expect(quotes.size).toBe(0)
  })
})

describe('valuePortfolio', () => {
  // 10 AAPL @ cost 15 (invested 150, NO quote) + 5 MGCRD ON @ cost 8
  // (invested 40, quoted 10) + 100 cash
  const inputs = {
    positions: [position('AAPL', 10, 15)] as any,
    onPositions: [position('MGCRD', 5, 8)] as any,
    cashBalance: 100,
    realized: 0,
    onRealized: 0,
  }
  const stockQuotes = new Map<string, Quote>()
  const onQuotes = new Map([['MGCRD', quote('MGCRD', 10)]])

  it("policy 'avg_cost' marks the unpriced position at its own cost", () => {
    // Act
    const result = valuePortfolio(inputs, { stockQuotes, onQuotes }, { missingQuotePolicy: 'avg_cost' })

    // Assert — AAPL at cost (150) + MGCRD at market (50) + cash (100)
    expect(result.summary.total_market_value).toBe(300)
    expect(result.summary.total_invested).toBe(190)
    expect(result.unpricedCount).toBe(1)
    expect(result.unpricedTickers).toEqual(['AAPL'])
  })

  it("policy 'drop' excludes the unpriced position from the totals, exactly like today", () => {
    // Act
    const result = valuePortfolio(inputs, { stockQuotes, onQuotes }, { missingQuotePolicy: 'drop' })

    // Assert — AAPL contributes neither value nor invested; still counted
    expect(result.summary.total_market_value).toBe(150) // 50 ON + 100 cash
    expect(result.summary.total_invested).toBe(40)
    expect(result.unpricedCount).toBe(1)
    expect(result.unpricedTickers).toEqual(['AAPL'])
  })

  it("policy 'drop' is byte-identical to calling the engine with untouched quotes", () => {
    // Act
    const viaValuation = valuePortfolio(inputs, { stockQuotes, onQuotes }, { missingQuotePolicy: 'drop' })
    const direct = calculatePortfolioSummary(
      inputs.positions, inputs.onPositions, stockQuotes, onQuotes,
      inputs.cashBalance, inputs.realized, inputs.onRealized
    )

    // Assert — the entire engine output passes through unchanged
    expect(viaValuation.summary).toEqual(direct.summary)
    expect(viaValuation.positions).toEqual(direct.positions)
    expect(viaValuation.onPositions).toEqual(direct.onPositions)
  })

  it('splits a FLAT quote map by ON-position membership, not by ticker name', () => {
    // Arrange — one flat map, the snapshotUser / live-point calling shape
    const flat = new Map([
      ['AAPL', quote('AAPL', 20)],
      ['MGCRD', quote('MGCRD', 10)],
    ])

    // Act
    const result = valuePortfolio(inputs, flat, { missingQuotePolicy: 'drop' })

    // Assert — AAPL priced as stock (200), MGCRD as ON (50), + 100 cash
    expect(result.summary.total_market_value).toBe(350)
    expect(result.summary.stocks.market_value).toBe(200)
    expect(result.summary.ons.market_value).toBe(50)
    expect(result.unpricedCount).toBe(0)
  })

  it("never mutates the caller's quote maps under 'avg_cost'", () => {
    // Act
    valuePortfolio(inputs, { stockQuotes, onQuotes }, { missingQuotePolicy: 'avg_cost' })

    // Assert — the synthetic AAPL cost quote landed in a copy, not here
    expect(stockQuotes.has('AAPL')).toBe(false)
  })
})
