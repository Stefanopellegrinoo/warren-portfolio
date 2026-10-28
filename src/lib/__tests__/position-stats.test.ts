import { describe, it, expect } from 'vitest'
import type { Quote } from '@/types'
import { enrichPositionsForStats, classIncome, resultByAsset } from '../position-stats'

// ── Helpers ──────────────────────────────────────────────────────────────────

function quote(ticker: string, price: number): Quote {
  return { ticker, price, change: 0, changePercent: 0, previousClose: price }
}

function position(ticker: string, quantity: number, avgCost: number) {
  return {
    ticker,
    quantity,
    avg_cost: avgCost,
    total_invested: quantity * avgCost,
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('enrichPositionsForStats', () => {
  it('values a priced position at market and reports its real P&L', () => {
    // Arrange — 10 AAPL bought @ 15, now quoted @ 20
    const positions = [position('AAPL', 10, 15)]
    const quotes = new Map([['AAPL', quote('AAPL', 20)]])

    // Act
    const { positions: enriched, totals } = enrichPositionsForStats(positions, quotes)

    // Assert
    expect(enriched[0]).toMatchObject({
      ticker: 'AAPL',
      market_value: 200,
      pnl: 50,
      priced: true,
    })
    expect(enriched[0].pnl_pct).toBeCloseTo(50 / 150)
    expect(totals.totalMarketValue).toBe(200)
    expect(totals.openPnl).toBe(50)
    expect(totals.unpricedCount).toBe(0)
  })

  it('marks a missing quote at average cost with ZERO P&L — never a fake -100% loss', () => {
    // Arrange — the audit bug: no quote for JD meant pnl = -total_invested
    const positions = [position('JD', 40, 25)]
    const quotes = new Map<string, Quote>()

    // Act
    const { positions: enriched, totals } = enrichPositionsForStats(positions, quotes)

    // Assert — valued at its own cost: neutral, visible, honest
    expect(enriched[0].market_value).toBeCloseTo(1000)
    expect(enriched[0].pnl).toBeCloseTo(0)
    expect(enriched[0].pnl_pct).toBeCloseTo(0)
    expect(enriched[0].priced).toBe(false)
    expect(totals.totalMarketValue).toBeCloseTo(1000)
    expect(totals.openPnl).toBeCloseTo(0)
    expect(totals.unpricedCount).toBe(1)
  })

  it('treats a zero-priced quote as missing (same LKP contract as the snapshot fallback)', () => {
    // Arrange
    const positions = [position('MGCRD', 5, 8)]
    const quotes = new Map([['MGCRD', quote('MGCRD', 0)]])

    // Act
    const { positions: enriched, totals } = enrichPositionsForStats(positions, quotes)

    // Assert
    expect(enriched[0].market_value).toBeCloseTo(40)
    expect(enriched[0].pnl).toBeCloseTo(0)
    expect(enriched[0].priced).toBe(false)
    expect(totals.unpricedCount).toBe(1)
  })

  it('falls back to total_invested when neither quote nor avg_cost are usable', () => {
    // Arrange — degenerate data: no quote and avg_cost 0
    const positions = [{ ticker: 'X', quantity: 3, avg_cost: 0, total_invested: 90 }]
    const quotes = new Map<string, Quote>()

    // Act
    const { positions: enriched } = enrichPositionsForStats(positions, quotes)

    // Assert — still neutral, still never -100%
    expect(enriched[0].market_value).toBe(90)
    expect(enriched[0].pnl).toBe(0)
    expect(enriched[0].priced).toBe(false)
  })

  it('strips legacy exchange prefixes for display but keeps the full ticker', () => {
    // Arrange
    const positions = [position('BCBA:GGAL', 10, 5)]
    const quotes = new Map([['BCBA:GGAL', quote('BCBA:GGAL', 6)]])

    // Act
    const { positions: enriched } = enrichPositionsForStats(positions, quotes)

    // Assert
    expect(enriched[0].ticker).toBe('GGAL')
    expect(enriched[0].fullTicker).toBe('BCBA:GGAL')
  })

  it('aggregates totals across priced and unpriced positions without poisoning the sum', () => {
    // Arrange — one priced winner + one unpriced position
    const positions = [position('AAPL', 10, 15), position('JD', 40, 25)]
    const quotes = new Map([['AAPL', quote('AAPL', 20)]])

    // Act
    const { totals } = enrichPositionsForStats(positions, quotes)

    // Assert — before the fix openPnl here read 50 - 1000 = -950
    expect(totals.totalMarketValue).toBeCloseTo(200 + 1000)
    expect(totals.openPnl).toBeCloseTo(50)
    expect(totals.unpricedCount).toBe(1)
  })
})

describe('enrichPositionsForStats — the one valuation rule (S3)', () => {
  it('marks an unquoted position at its last close before its cost', () => {
    const { positions, totals } = enrichPositionsForStats([position('ONA', 10, 95)], new Map(), new Map([['ONA', 98]]))

    expect(positions[0]).toMatchObject({ market_value: 980, priced: false })
    expect(totals.openPnl).toBeCloseTo(30)
  })
})

// ── Income, per-asset result and the chart's selection (odd/tasks/statistics-truth.md S7) ──

const row = (ticker: string, operation: string, quantity: number, price: number, asset_type: string | null = 'ACCION') =>
  ({ ticker, operation, quantity, price, asset_type })

describe('classIncome — the dividends and coupons the headline counts', () => {
  const rows = [
    row('KO', 'COMPRA', 10, 60),
    row('ko ', 'DIVIDENDO', 1, 4.5),
    row('KO', 'DIVIDENDO', -2, 3),
    row('ONA', 'COMPRA', 10, 95, 'ON'),
    row('ONA', 'CUPON', 1, 7, null),
  ]
  const automatic = [
    { ticker: 'ONA', kind: 'coupon', amount: 12 },
    { ticker: 'ONA', kind: 'amortization', amount: 500 },
  ]

  it('sums each stock ticker\'s DIVIDENDO rows (|quantity| × price) and nothing from the ONs', () => {
    expect(classIncome(rows, automatic, 'STOCK')).toEqual(new Map([['KO', 10.5]]))
  })

  it('sums each ON\'s coupon rows and the core\'s automatic coupons — an amortization is capital, not income', () => {
    expect(classIncome(rows, automatic, 'ON')).toEqual(new Map([['ONA', 19]]))
  })
})

describe('resultByAsset — one bar per asset', () => {
  it('adds the open result, every sale and the income of the same ticker, best first', () => {
    const { positions: open } = enrichPositionsForStats(
      [position('BCBA:GGAL', 10, 5), position('KO', 10, 60)],
      new Map([['BCBA:GGAL', quote('BCBA:GGAL', 6)], ['KO', quote('KO', 55)]])
    )
    const sales = [{ ticker: 'KO', pnl: 20 }, { ticker: 'KO', pnl: -5 }, { ticker: 'MELI', pnl: -30 }]

    expect(resultByAsset(open, sales, new Map([['KO', 10.5]]))).toEqual([
      { ticker: 'GGAL', pnl: 10 },
      { ticker: 'KO', pnl: -50 + 15 + 10.5 },
      { ticker: 'MELI', pnl: -30 },
    ])
  })
})
