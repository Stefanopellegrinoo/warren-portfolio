import { describe, it, expect } from 'vitest'
import { calcDayPnL, calcDayPnLPct, hasDayData } from './PnLSidebar'
import type { Position } from '@/types'

// Minimal position fixture
function makePosition(ticker: string, quantity: number, avg_cost = 100): Position {
  return {
    id: `pos-${ticker}`,
    user_id: 'user-1',
    ticker,
    quantity,
    avg_cost,
    total_invested: avg_cost * quantity,
    first_bought: '2024-01-01',
    last_updated: '2024-01-01',
    version: 1,
  }
}

describe('calcDayPnL', () => {
  it('(a) sums change * qty across all positions', () => {
    const positions = [
      makePosition('AAPL', 10),
      makePosition('MSFT', 5),
    ]
    const changes = new Map([
      ['AAPL', 2.0],
      ['MSFT', -1.0],
    ])
    // 2.0 * 10 + (-1.0) * 5 = 20 - 5 = 15
    expect(calcDayPnL(positions, changes)).toBe(15)
  })

  it('returns 0 when no positions', () => {
    expect(calcDayPnL([], new Map())).toBe(0)
  })

  it('treats missing change entries as 0', () => {
    const positions = [makePosition('AAPL', 10)]
    const changes = new Map<string, number>()
    expect(calcDayPnL(positions, changes)).toBe(0)
  })
})

describe('hasDayData', () => {
  it('(b) returns false when all changes are 0', () => {
    const changes = new Map([
      ['AAPL', 0],
      ['MSFT', 0],
    ])
    expect(hasDayData(changes)).toBe(false)
  })

  it('returns true when at least one change is non-zero', () => {
    const changes = new Map([
      ['AAPL', 0],
      ['MSFT', 1.5],
    ])
    expect(hasDayData(changes)).toBe(true)
  })

  it('returns false for empty changes map', () => {
    expect(hasDayData(new Map())).toBe(false)
  })
})

describe('calcDayPnLPct', () => {
  it('(c) returns null when totalPortfolio equals dayPnL (zero-division guard)', () => {
    // totalPortfolio - dayPnL = 0 → null
    const result = calcDayPnLPct(100, 100)
    expect(result).toBeNull()
  })

  it('returns correct percentage for positive dayPnL', () => {
    // dayPnL=50, totalPortfolio=1050 → 50 / (1050 - 50) * 100 = 50/1000*100 = 5
    const result = calcDayPnLPct(50, 1050)
    expect(result).toBeCloseTo(5, 5)
  })

  it('returns correct negative percentage for negative dayPnL', () => {
    // dayPnL=-50, totalPortfolio=950 → -50 / (950 - (-50)) * 100 = -50/1000*100 = -5
    const result = calcDayPnLPct(-50, 950)
    expect(result).toBeCloseTo(-5, 5)
  })

  it('returns null when totalPortfolio is 0 and dayPnL is 0', () => {
    expect(calcDayPnLPct(0, 0)).toBeNull()
  })
})
