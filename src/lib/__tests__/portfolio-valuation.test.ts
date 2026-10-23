import { describe, it, expect } from 'vitest'
import type { Quote } from '@/types'
import { applyValuationRule, splitQuotesByAssetClass, valuePortfolio } from '../portfolio-valuation'

// ── Helpers ──────────────────────────────────────────────────────────────────

function quote(ticker: string, price: number): Quote {
  return { ticker, price, change: 0, changePercent: 0, previousClose: price }
}

function position(ticker: string, quantity: number, avgCost: number) {
  return { ticker, quantity, avg_cost: avgCost, total_invested: quantity * avgCost }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('applyValuationRule', () => {
  it('leaves a priced position untouched and reports zero unpriced', () => {
    // Arrange
    const positions = [position('AAPL', 10, 15)]
    const quotes = new Map([['AAPL', quote('AAPL', 20)]])

    // Act
    const result = applyValuationRule(positions, quotes)

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
    const result = applyValuationRule(positions, quotes)

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
    const result = applyValuationRule(positions, quotes)

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
    const result = applyValuationRule(positions, quotes)

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
    applyValuationRule(positions, quotes)

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

  it('marks an unpriced position at its own cost (S3, last tier)', () => {
    // Act
    const result = valuePortfolio(inputs, { stockQuotes, onQuotes })

    // Assert — AAPL at cost (150) + MGCRD at market (50) + cash (100)
    expect(result.summary.total_market_value).toBe(300)
    expect(result.summary.total_invested).toBe(190)
    expect(result.unpricedCount).toBe(1)
    expect(result.unpricedTickers).toEqual(['AAPL'])
  })

  it('marks an unpriced position at its last close before its cost (S3, middle tier)', () => {
    // Act — AAPL has no quote but last closed at 18
    const result = valuePortfolio(inputs, { stockQuotes, onQuotes }, new Map([['AAPL', 18]]))

    // Assert — AAPL 10 × 18 + MGCRD 50 + cash 100
    expect(result.summary.total_market_value).toBe(330)
    expect(result.summary.stocks.pnl).toBe(30)
    expect(result.unpricedTickers).toEqual(['AAPL'])
  })

  it('prefers the live quote over the last close (S3, first tier)', () => {
    // Act — MGCRD is quoted at 10 and last closed at 9
    const result = valuePortfolio(inputs, { stockQuotes, onQuotes }, new Map([['MGCRD', 9]]))

    // Assert
    expect(result.summary.ons.market_value).toBe(50)
  })

  it('splits a FLAT quote map by ON-position membership, not by ticker name', () => {
    // Arrange — one flat map, the snapshotUser / live-point calling shape
    const flat = new Map([
      ['AAPL', quote('AAPL', 20)],
      ['MGCRD', quote('MGCRD', 10)],
    ])

    // Act
    const result = valuePortfolio(inputs, flat)

    // Assert — AAPL priced as stock (200), MGCRD as ON (50), + 100 cash
    expect(result.summary.total_market_value).toBe(350)
    expect(result.summary.stocks.market_value).toBe(200)
    expect(result.summary.ons.market_value).toBe(50)
    expect(result.unpricedCount).toBe(0)
  })

  it("never mutates the caller's quote maps", () => {
    // Act
    valuePortfolio(inputs, { stockQuotes, onQuotes })

    // Assert — the synthetic AAPL cost quote landed in a copy, not here
    expect(stockQuotes.has('AAPL')).toBe(false)
  })
})

describe('splitQuotesByAssetClass', () => {
  it('classifies a stock whose ticker ends in D as a stock, not an ON', () => {
    // Arrange — JD (JD.com) is a real CEDEAR the portfolio holds. Classifying by
    // the "D" suffix would route it to Data912 pricing and drop it from the
    // stock totals entirely.
    const all = new Map([
      ['JD', quote('JD', 42)],
      ['MGCRD', quote('MGCRD', 100)],
    ])

    // Act — ON membership comes from the ON tables, not from the name
    const { stockQuotes, onQuotes } = splitQuotesByAssetClass(all, ['MGCRD'])

    // Assert
    expect(stockQuotes.has('JD')).toBe(true)
    expect(onQuotes.has('JD')).toBe(false)
    expect(onQuotes.has('MGCRD')).toBe(true)
    expect(stockQuotes.has('MGCRD')).toBe(false)
  })

  it('matches ON membership case-insensitively', () => {
    // Arrange
    const all = new Map([['cs50d', quote('cs50d', 104)]])

    // Act
    const { stockQuotes, onQuotes } = splitQuotesByAssetClass(all, [' CS50D '])

    // Assert — the quote keeps its original casing but lands in the ON bucket
    expect(onQuotes.has('cs50d')).toBe(true)
    expect(stockQuotes.size).toBe(0)
  })

  it('treats an unknown ticker as a stock', () => {
    // Arrange
    const all = new Map([['AAPL', quote('AAPL', 200)]])

    // Act
    const { stockQuotes, onQuotes } = splitQuotesByAssetClass(all, [])

    // Assert
    expect(stockQuotes.has('AAPL')).toBe(true)
    expect(onQuotes.size).toBe(0)
  })
})
