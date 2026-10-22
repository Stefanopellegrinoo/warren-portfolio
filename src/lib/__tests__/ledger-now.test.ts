import { describe, it, expect, vi } from 'vitest'
import { ledgerSupabase, trade, movement } from './fixtures/ledger-supabase'

vi.mock('../on-schedules', () => ({
  loadSchedules: vi.fn(async (_sb: unknown, tickers: string[]) =>
    new Map(tickers.includes('ONA') ? [['ONA', [
      { date: '2026-02-10', ren: 2, amo: 0 },
      { date: '2027-02-10', ren: 2, amo: 0 },
    ]]] : [])),
}))

const { markPrice, loadPortfolioNow, closedTradesOf } = await import('../ledger-now')

const TODAY = '2026-03-01'

describe('markPrice — the one valuation rule (S3)', () => {
  it('takes the live quote when it is positive', () => {
    expect(markPrice(120, 110, 100)).toBe(120)
  })
  it('falls back to the last close when the live quote is missing or zero', () => {
    expect(markPrice(0, 110, 100)).toBe(110)
    expect(markPrice(undefined, 110, 100)).toBe(110)
  })
  it('falls back to the holding cost when there is neither', () => {
    expect(markPrice(null, null, 100)).toBe(100)
    expect(markPrice(0, 0, 100)).toBe(100)
  })
})

describe('loadPortfolioNow — current state from the ledger core', () => {
  it('reads only the ledger, never the stored derived tables', async () => {
    const log: string[] = []
    const sb = ledgerSupabase({ transactions: [trade()], cash_movements: [movement()] }, log)

    const now = await loadPortfolioNow(sb, 'u1', TODAY)

    expect(now.stockPositions).toMatchObject([{ ticker: 'AAPL', quantity: 10, avg_cost: 100, total_invested: 1000 }])
    expect(log).toEqual(expect.arrayContaining(['transactions', 'cash_movements', 'on_payment_overrides']))
  })

  it('cash includes an automatic ON coupon paid by today, not a future one', async () => {
    const sb = ledgerSupabase({
      transactions: [trade({ ticker: 'ONA', asset_type: 'ON', quantity: 10, price: 95, date: '2026-01-05' })],
      cash_movements: [movement({ amount: 1000 }), movement({ type: 'COMPRA', amount: 950, date: '2026-01-05' })],
    })

    const now = await loadPortfolioNow(sb, 'u1', TODAY)

    // 1000 − 950 + 10 × 2 (2026-02-10); the 2027 coupon is not paid yet.
    expect(now.cashBalance).toBeCloseTo(70)
    expect(now.onPositions).toMatchObject([{ ticker: 'ONA', quantity: 10 }])
  })

  it('includes a future-dated trade, as the stored state did', async () => {
    const sb = ledgerSupabase({ transactions: [trade({ date: '2026-03-03' })] })

    const now = await loadPortfolioNow(sb, 'u1', TODAY)

    expect(now.stockPositions.map(p => p.ticker)).toEqual(['AAPL'])
  })

  it('a holding sold down below dust is closed', async () => {
    const sb = ledgerSupabase({ transactions: [
      trade(), trade({ operation: 'VENTA', quantity: 9.99995, price: 110, date: '2026-01-06' }),
    ] })

    const now = await loadPortfolioNow(sb, 'u1', TODAY)

    expect(now.stockPositions).toEqual([])
  })

  it('realizes a sale the stored closed_trades missed (L8: VIST 2026-04-09)', async () => {
    const sb = ledgerSupabase({ transactions: [
      trade({ ticker: 'VIST', quantity: 100, price: 43.64, date: '2026-03-02' }),
      trade({ ticker: 'VIST', operation: 'VENTA', quantity: 57.333333, price: 64.8508, date: '2026-04-09' }),
    ] })

    const now = await loadPortfolioNow(sb, 'u1', '2026-10-22')

    expect(now.stockClosedTrades).toHaveLength(1)
    expect(now.stockClosedTrades[0]).toMatchObject({
      ticker: 'VIST', open_date: '2026-03-02', close_date: '2026-04-09', days_held: 38, close_price: 64.8508,
    })
    expect(now.stockClosedTrades[0].pnl).toBeCloseTo(1216.09, 2)
  })

  it('a failed ledger read throws instead of serving an empty portfolio', async () => {
    const sb = ledgerSupabase({ transactions: { error: { message: 'boom' } } })
    await expect(loadPortfolioNow(sb, 'u1', TODAY)).rejects.toThrow()
  })
})

describe('closedTradesOf', () => {
  it('takes the open date of the position the sale closed, after a full close and rebuy', () => {
    const trades = [
      trade({ date: '2026-01-05' }),
      trade({ operation: 'VENTA', price: 120, date: '2026-01-10' }),
      trade({ price: 90, date: '2026-02-01' }),
      trade({ operation: 'VENTA', quantity: 4, price: 95, date: '2026-02-03' }),
    ]
    const realized = [
      { ticker: 'AAPL', assetType: 'STOCK' as const, date: '2026-01-10', quantity: 10, invested: 1000, proceeds: 1200, pnl: 200 },
      { ticker: 'AAPL', assetType: 'STOCK' as const, date: '2026-02-03', quantity: 4, invested: 360, proceeds: 380, pnl: 20 },
    ]

    const closed = closedTradesOf('u1', trades, realized)

    expect(closed.map(c => [c.open_date, c.close_date, c.close_price])).toEqual([
      ['2026-01-05', '2026-01-10', 120],
      ['2026-02-01', '2026-02-03', 95],
    ])
  })
})
