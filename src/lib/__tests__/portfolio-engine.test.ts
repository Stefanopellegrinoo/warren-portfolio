import { describe, it, expect, vi } from 'vitest'
// Ledger reads load the stock splits (odd/tasks/split-aware-ledger.md T3): none in these tests.
vi.mock('@/lib/stock-splits', () => ({ loadSplits: async () => new Map() }))
import { calculatePositionLotsDefinition } from '../portfolio-engine'

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

describe('getFullPortfolio — reads the ledger core (T4.2b)', () => {
  it('builds positions, closed trades and cash from the ledger, never from the stored tables', async () => {
    const { getFullPortfolio } = await import('../portfolio-engine')
    const { ledgerSupabase, trade, movement } = await import('./fixtures/ledger-supabase')
    const sb = ledgerSupabase({
      transactions: [trade(), trade({ operation: 'VENTA', quantity: 4, price: 120, date: '2026-01-06' })],
      cash_movements: [movement({ amount: 2000 })],
    })

    const p = await getFullPortfolio(sb, 'u1', '2026-02-01')

    expect(p.stockPositions).toMatchObject([{ ticker: 'AAPL', quantity: 6, avg_cost: 100, total_invested: 600 }])
    expect(p.stockClosedTrades).toMatchObject([{ ticker: 'AAPL', quantity: 4, pnl: 80 }])
    expect(p.onPositions).toEqual([])
    expect(p.cashBalance).toBe(2000)
  })
})
