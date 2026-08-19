import { describe, it, expect } from 'vitest'
import { computeTradeStats } from '../trade-stats'

// ── Helpers ──────────────────────────────────────────────────────────────────

function trade(pnl: number, closeDate = '2026-03-10', daysHeld: number | null = 5) {
  return { pnl, close_date: closeDate, days_held: daysHeld }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('computeTradeStats — profit factor', () => {
  it('uses GROSS sums, not averages: 9 wins of $10 vs 1 loss of $100 → 0.9', () => {
    // Arrange — the audit case: avgWin/|avgLoss| = 10/100 showed 0.10x
    const trades = [
      ...Array.from({ length: 9 }, () => trade(10)),
      trade(-100),
    ]

    // Act
    const stats = computeTradeStats(trades)

    // Assert — gross 90 / gross 100
    expect(stats.profitFactor).toBeCloseTo(0.9)
  })

  it('returns null (not 0) when there are wins and no losses — a perfect record is not a catastrophe', () => {
    // Arrange
    const trades = [trade(50), trade(30)]

    // Act
    const stats = computeTradeStats(trades)

    // Assert — old code returned 0, rendering a perfect record in red
    expect(stats.profitFactor).toBeNull()
    expect(stats.winnersCount).toBe(2)
    expect(stats.losersCount).toBe(0)
  })

  it('returns null when there are no trades at all', () => {
    const stats = computeTradeStats([])
    expect(stats.profitFactor).toBeNull()
    expect(stats.winRate).toBeNull()
    expect(stats.totalTrades).toBe(0)
  })
})

describe('computeTradeStats — win rate over CLOSED trades', () => {
  it('winRate = winners / total closed trades, matching its own W/L subtitle', () => {
    // Arrange — 2 winners, 1 loser, 1 breakeven
    const trades = [trade(10), trade(20), trade(-5), trade(0)]

    // Act
    const stats = computeTradeStats(trades)

    // Assert
    expect(stats.totalTrades).toBe(4)
    expect(stats.winnersCount).toBe(2)
    expect(stats.losersCount).toBe(1)
    expect(stats.winRate).toBeCloseTo(0.5)
  })

  it('averages wins and losses separately', () => {
    const trades = [trade(10), trade(30), trade(-8)]
    const stats = computeTradeStats(trades)
    expect(stats.avgWin).toBeCloseTo(20)
    expect(stats.avgLoss).toBeCloseTo(-8)
  })
})

describe('computeTradeStats — monthly grouping', () => {
  it('groups by the close_date string itself, immune to server timezone', () => {
    // Arrange — first-of-month dates were the TZ hazard with new Date()
    const trades = [
      trade(10, '2026-01-01'),
      trade(20, '2026-01-31'),
      trade(-5, '2026-02-01'),
    ]

    // Act
    const stats = computeTradeStats(trades)

    // Assert
    expect(stats.monthlyReturns).toEqual([
      { month: '2026-01', pnl: 30, trades: 2 },
      { month: '2026-02', pnl: -5, trades: 1 },
    ])
  })

  it('sorts months chronologically regardless of input order', () => {
    const trades = [trade(5, '2026-03-15'), trade(7, '2026-01-10')]
    const stats = computeTradeStats(trades)
    expect(stats.monthlyReturns.map((m) => m.month)).toEqual(['2026-01', '2026-03'])
  })
})

describe('computeTradeStats — holding period', () => {
  it('computes avg/min/max over trades that HAVE days_held, ignoring nulls', () => {
    // Arrange — a null days_held used to count as 0 and fake the minimum
    const trades = [trade(10, '2026-03-10', 10), trade(5, '2026-03-11', 20), trade(1, '2026-03-12', null)]

    // Act
    const stats = computeTradeStats(trades)

    // Assert
    expect(stats.avgHoldingDays).toBe(15)
    expect(stats.minHoldingDays).toBe(10)
    expect(stats.maxHoldingDays).toBe(20)
  })

  it('returns zeros when no trade has a holding period', () => {
    const stats = computeTradeStats([trade(10, '2026-03-10', null)])
    expect(stats.avgHoldingDays).toBe(0)
    expect(stats.minHoldingDays).toBe(0)
    expect(stats.maxHoldingDays).toBe(0)
  })
})
