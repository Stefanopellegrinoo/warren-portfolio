import { describe, it, expect, vi } from 'vitest'
// Ledger reads load the stock splits (odd/tasks/split-aware-ledger.md T3): none in these tests.
vi.mock('@/lib/stock-splits', () => ({ loadSplits: async () => new Map() }))

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
