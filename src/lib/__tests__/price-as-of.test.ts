import { describe, it, expect } from 'vitest'
import type { Position, ONPosition, Quote } from '@/types'
import { calculatePortfolioSummary } from '../portfolio-engine'
import { countStalePrices } from '../utils'

const base = { id: 'p', user_id: 'u-synthetic', first_bought: null, last_updated: '', version: 1 }
const stock = (ticker: string): Position => ({ ...base, ticker, quantity: 10, avg_cost: 5, total_invested: 50 })
const on = (ticker: string): ONPosition => ({ ...base, ticker, quantity: 10, avg_cost: 5, total_invested: 50 })
const quote = (ticker: string, updatedAt?: string): Quote =>
  ({ ticker, price: 6, change: 0, changePercent: 0, previousClose: 6, updatedAt })

describe('price_as_of', () => {
  it('copies Quote.updatedAt onto stock and ON positions without changing valuation', () => {
    const at = '2026-10-14T15:00:00.000Z'
    const { positions, onPositions, summary } = calculatePortfolioSummary(
      [stock('AAA')], [on('ONX')],
      new Map([['AAA', quote('AAA', at)]]), new Map([['ONX', quote('ONX', at)]]), 0,
    )
    expect(positions[0].price_as_of).toBe(at)
    expect(onPositions[0].price_as_of).toBe(at)
    expect(positions[0].market_value).toBe(60)
    expect(summary.total_market_value).toBe(120)
  })

  it('leaves price_as_of undefined when there is no quote', () => {
    const { positions } = calculatePortfolioSummary([stock('AAA')], [], new Map(), new Map(), 0)
    expect(positions[0].price_as_of).toBeUndefined()
  })
})

describe('countStalePrices', () => {
  const now = new Date('2026-10-14T15:00:00Z') // market open
  it('counts only priced positions whose as-of is stale', () => {
    const fresh = { current_price: 1, price_as_of: '2026-10-14T14:50:00Z' }
    const stale = { current_price: 1, price_as_of: '2026-10-14T10:00:00Z' }
    const noTime = { current_price: 1 }
    const unpriced = {}
    expect(countStalePrices([fresh, stale, noTime, unpriced], now)).toBe(2)
  })
})
