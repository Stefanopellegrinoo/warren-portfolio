import { describe, it, expect } from 'vitest'
import { calculatePortfolioSummary } from '../portfolio-engine'
import type { Position, ONPosition, Quote } from '@/types'

// odd/tasks/day-change.md S3: today's % is today's move over yesterday's value, not over cost.
// Invented values only.
const stock: Position = { id: '1', user_id: 'u1', ticker: 'AAPL', quantity: 10, avg_cost: 50, total_invested: 500, first_bought: '2024-01-01', last_updated: '', version: 1 }
const on = { id: '2', user_id: 'u1', ticker: 'TST1O', quantity: 100, avg_cost: 80, total_invested: 8000, first_bought: '2026-01-01', last_updated: '', version: 1 } as unknown as ONPosition
const quotes = (entries: [string, Quote][]) => new Map<string, Quote>(entries)

describe('calculatePortfolioSummary — day %', () => {
  it('divides today\'s move by what the holdings were worth yesterday, per class and in total', () => {
    const { summary } = calculatePortfolioSummary(
      [stock], [on],
      quotes([['AAPL', { ticker: 'AAPL', price: 110, change: 10, changePercent: 10 / 100, previousClose: 100 }]]),
      quotes([['TST1O', { ticker: 'TST1O', price: 105, change: 5, changePercent: 5 / 100, previousClose: 100 }]]),
      0,
    )
    // AAPL: 1.100 today, +100 → 1.000 yesterday (cost 500 would read +20 %).
    expect(summary.stocks.day_pnl).toBe(100)
    expect(summary.stocks.day_pnl_pct).toBeCloseTo(0.1, 12)
    // The ON: 10.500 today, +500 → 10.000 yesterday (cost 8.000 would read +6,25 %).
    expect(summary.ons.day_pnl_pct).toBeCloseTo(0.05, 12)
    expect(summary.day_pnl).toBe(600)
    expect(summary.day_pnl_pct).toBeCloseTo(600 / 11_000, 12)
  })

  it('reads 0 with nothing priced, as before', () => {
    const { summary } = calculatePortfolioSummary([stock], [], new Map(), new Map(), 0)
    expect(summary.day_pnl_pct).toBe(0)
    expect(summary.stocks.day_pnl_pct).toBe(0)
  })
})
