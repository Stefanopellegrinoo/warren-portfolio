import { describe, it, expect } from 'vitest'
import { calculateRunningAvgCost, calculatePositionLotsDefinition } from '../portfolio-engine'

describe('Portfolio Engine - calculateRunningAvgCost', () => {
  it('calculates initial buy correctly', () => {
    const txs = [
      { operation: 'COMPRA', quantity: 10, price: 100, commission: 10 }
    ]
    const result = calculateRunningAvgCost(txs as any)
    // Cost Basis = (10 * 100) + 10 = 1010
    // Avg Cost = 1010 / 10 = 101
    expect(result.quantity).toBe(10)
    expect(result.avgCost).toBe(101)
    expect(result.costBasis).toBe(1010)
  })

  it('updates avg cost on second buy', () => {
    const txs = [
      { operation: 'COMPRA', quantity: 10, price: 100, commission: 10 }, // Cost: 1010, Qty: 10
      { operation: 'COMPRA', quantity: 10, price: 200, commission: 10 }  // Cost: 2010, Qty: 10
    ]
    const result = calculateRunningAvgCost(txs as any)
    // Total Cost = 1010 + 2010 = 3020
    // Total Qty = 20
    // New Avg = 3020 / 20 = 151
    expect(result.quantity).toBe(20)
    expect(result.avgCost).toBe(151)
  })

  it('does NOT change avg cost on partial sell', () => {
    const txs = [
      { operation: 'COMPRA', quantity: 10, price: 100, commission: 0 }, // Avg: 100
      { operation: 'VENTA', quantity: 5, price: 500, commission: 50 }   // Sell half at profit
    ]
    const result = calculateRunningAvgCost(txs as any)
    // Avg should remain 100
    // Qty should be 5
    // Cost Basis should be 500
    expect(result.quantity).toBe(5)
    expect(result.avgCost).toBe(100)
    expect(result.costBasis).toBe(500)
  })

  it('resets to zero after full sell', () => {
    const txs = [
      { operation: 'COMPRA', quantity: 10, price: 100, commission: 0 },
      { operation: 'VENTA', quantity: 10, price: 200, commission: 0 }
    ]
    const result = calculateRunningAvgCost(txs as any)
    expect(result.quantity).toBe(0)
    expect(result.avgCost).toBe(0)
    expect(result.costBasis).toBe(0)
  })
})

describe('Portfolio Engine - FIFO Lots', () => {
  it('correctly tracks remaining lots using FIFO', () => {
    const txs = [
      { id: '1', date: '2024-01-01', operation: 'COMPRA', quantity: 10, price: 100, commission: 0 },
      { id: '2', date: '2024-01-02', operation: 'COMPRA', quantity: 10, price: 200, commission: 0 },
      { id: '3', date: '2024-01-03', operation: 'VENTA', quantity: 15, price: 150, commission: 0 }
    ]
    const lots = calculatePositionLotsDefinition(txs as any)
    
    // 15 sold:
    // - 10 from the first lot (it's gone)
    // - 5 from the second lot (5 remaining)
    expect(lots.length).toBe(1)
    expect(lots[0].remaining_quantity).toBe(5)
    expect(lots[0].buy_price).toBe(200) // The second lot's price
  })
})
