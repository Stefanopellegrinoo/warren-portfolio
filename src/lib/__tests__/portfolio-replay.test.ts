import { describe, it, expect } from 'vitest'
import { replayPortfolioAt } from '../portfolio-replay'
import type { ReplayMovement, ReplayTransaction } from '../portfolio-replay'

function tx(over: Partial<ReplayTransaction>): ReplayTransaction {
  return {
    ticker: 'AAPL',
    operation: 'COMPRA',
    quantity: 10,
    price: 100,
    commission: 0,
    date: '2022-02-09',
    asset_type: 'ACCION',
    created_at: null,
    ...over,
  }
}

describe('replayPortfolioAt', () => {
  it('applies running weighted-average cost to buys', () => {
    const state = replayPortfolioAt(
      [
        tx({ quantity: 10, price: 100, commission: 5, date: '2022-02-09' }),
        tx({ quantity: 10, price: 120, commission: 5, date: '2022-03-09' }),
      ],
      [],
      '2022-03-09'
    )

    // (1000 + 5 + 1200 + 5) / 20 = 110.5
    expect(state.positions).toHaveLength(1)
    expect(state.positions[0].quantity).toBe(20)
    expect(state.positions[0].avg_cost).toBeCloseTo(110.5, 10)
    expect(state.positions[0].total_invested).toBeCloseTo(2210, 10)
  })

  it('IGNORES transactions dated after the replay date', () => {
    // The whole premise of per-day replay. A later buy must not appear in an
    // earlier day's state or the reconstructed series shows a position the
    // user did not hold yet.
    const state = replayPortfolioAt(
      [
        tx({ quantity: 10, price: 100, date: '2022-02-09' }),
        tx({ quantity: 10, price: 100, date: '2022-06-01' }),
      ],
      [],
      '2022-03-01'
    )

    expect(state.positions[0].quantity).toBe(10)
  })

  it('includes a transaction dated exactly on the replay date', () => {
    const state = replayPortfolioAt([tx({ date: '2022-03-01' })], [], '2022-03-01')
    expect(state.positions).toHaveLength(1)
  })

  it('drops a position that was fully sold before the replay date', () => {
    const state = replayPortfolioAt(
      [
        tx({ quantity: 10, price: 100, date: '2022-02-09' }),
        tx({ operation: 'VENTA', quantity: 10, price: 150, date: '2022-03-09' }),
      ],
      [],
      '2022-04-01'
    )

    expect(state.positions).toHaveLength(0)
  })

  it('still holds that position on a day BEFORE it was sold', () => {
    // Survivorship bias was audit finding H4. A ticker sold in 2023 was held
    // in 2022 and must be valued on those days.
    const state = replayPortfolioAt(
      [
        tx({ quantity: 10, price: 100, date: '2022-02-09' }),
        tx({ operation: 'VENTA', quantity: 10, price: 150, date: '2023-03-09' }),
      ],
      [],
      '2022-12-31'
    )

    expect(state.positions).toHaveLength(1)
    expect(state.positions[0].quantity).toBe(10)
  })

  it('leaves avg_cost untouched on a partial sale and reduces cost basis pro rata', () => {
    const state = replayPortfolioAt(
      [
        tx({ quantity: 10, price: 100, commission: 0, date: '2022-02-09' }),
        tx({ operation: 'VENTA', quantity: 4, price: 150, date: '2022-03-09' }),
      ],
      [],
      '2022-03-09'
    )

    expect(state.positions[0].quantity).toBe(6)
    expect(state.positions[0].avg_cost).toBeCloseTo(100, 10)
    expect(state.positions[0].total_invested).toBeCloseTo(600, 10)
  })

  it('routes ONs by asset_type, not by the D suffix', () => {
    // AMD, FORD and JD are stocks ending in D. Classifying by suffix sent them
    // to the ON bucket, which left the engine without a stock price for them.
    const state = replayPortfolioAt(
      [
        tx({ ticker: 'AMD', asset_type: 'ACCION' }),
        tx({ ticker: 'MGCRD', asset_type: 'ON' }),
      ],
      [],
      '2022-02-09'
    )

    expect(state.positions.map(p => p.ticker)).toEqual(['AMD'])
    expect(state.onPositions.map(p => p.ticker)).toEqual(['MGCRD'])
  })

  it('treats a missing asset_type as a stock rather than dropping the position', () => {
    const state = replayPortfolioAt([tx({ ticker: 'AAPL', asset_type: null })], [], '2022-02-09')

    expect(state.positions.map(p => p.ticker)).toEqual(['AAPL'])
    expect(state.onPositions).toHaveLength(0)
  })

  it('replays cash with the ledger sign rule, ignoring later movements', () => {
    const movements: ReplayMovement[] = [
      { type: 'DEPOSITO', amount: 1000, date: '2022-02-01' },
      { type: 'COMPRA', amount: 400, date: '2022-02-09' },
      { type: 'VENTA', amount: 150, date: '2022-03-09' },
      { type: 'RETIRO', amount: 50, date: '2022-06-01' },
    ]

    const state = replayPortfolioAt([], movements, '2022-03-09')

    expect(state.cashBalance).toBeCloseTo(750, 10)
  })

  it('returns an empty state for a date before any activity', () => {
    const state = replayPortfolioAt(
      [tx({ date: '2022-02-09' })],
      [{ type: 'DEPOSITO', amount: 1000, date: '2022-02-01' }],
      '2021-12-31'
    )

    expect(state.positions).toHaveLength(0)
    expect(state.onPositions).toHaveLength(0)
    expect(state.cashBalance).toBe(0)
  })

  it('orders each ticker chronologically regardless of input order', () => {
    // Running average cost is sequential — a sale processed before its buy
    // silently produces a different basis.
    const shuffled = [
      tx({ operation: 'VENTA', quantity: 4, price: 150, date: '2022-03-09' }),
      tx({ quantity: 10, price: 100, commission: 0, date: '2022-02-09' }),
    ]

    const state = replayPortfolioAt(shuffled, [], '2022-03-09')

    expect(state.positions[0].quantity).toBe(6)
    expect(state.positions[0].avg_cost).toBeCloseTo(100, 10)
  })

  it('tolerates a date carrying a timestamp', () => {
    const state = replayPortfolioAt(
      [tx({ date: '2022-03-01T00:00:00.000Z' })],
      [{ type: 'DEPOSITO', amount: 100, date: '2022-03-01T12:00:00.000Z' }],
      '2022-03-01'
    )

    expect(state.positions).toHaveLength(1)
    expect(state.cashBalance).toBe(100)
  })

  it('processes a same-day COMPRA before a same-day VENTA even when passed sell-first', () => {
    // The engine discards a VENTA that arrives with quantity 0 (`if (quantity > 0)`),
    // so a sell-first order would leave an OPEN position for a ticker closed that
    // day — and repeat it in every later day.
    const sellFirst = [
      tx({ operation: 'VENTA', quantity: 10, price: 150, date: '2022-02-09', created_at: null }),
      tx({ operation: 'COMPRA', quantity: 10, price: 100, date: '2022-02-09', created_at: null }),
    ]

    const state = replayPortfolioAt(sellFirst, [], '2022-02-09')

    expect(state.positions).toHaveLength(0)
  })

  it('orders same-day rows by created_at even when the operation tiebreak DISAGREES', () => {
    // The two ordering levels must disagree or this proves nothing. A fixture
    // whose created_at happens to put the COMPRA first is decided identically by
    // the tiebreak below it, so it passes with the created_at level deleted —
    // leaving the riskiest comparator in the backfill unguarded.
    //
    // Prior day    COMPRA 10 @ 100      → qty 10, basis 1000
    //
    // created_at order (VENTA earlier, COMPRA later) — the CORRECT one:
    //   VENTA   4 @ 150  → basis 1000 - 4*(1000/10) =  600, qty  6
    //   COMPRA 10 @ 200  → basis  600 + 2000        = 2600, qty 16 → avg 162.5
    //
    // tiebreak-only order (COMPRA first):
    //   COMPRA 10 @ 200  → basis 1000 + 2000        = 3000, qty 20
    //   VENTA   4 @ 150  → basis 3000 - 4*(3000/20) = 2400, qty 16 → avg 150
    //
    // Quantity is 16 either way; only avg_cost separates them.
    const rows = [
      tx({ operation: 'COMPRA', quantity: 10, price: 100, commission: 0, date: '2022-02-08', created_at: '2026-03-16T21:20:00.000Z' }),
      tx({ operation: 'COMPRA', quantity: 10, price: 200, commission: 0, date: '2022-02-09', created_at: '2026-03-16T21:20:09.000Z' }),
      tx({ operation: 'VENTA', quantity: 4, price: 150, commission: 0, date: '2022-02-09', created_at: '2026-03-16T21:20:08.000Z' }),
    ]

    const state = replayPortfolioAt(rows, [], '2022-02-09')

    expect(state.positions[0].quantity).toBe(16)
    // 162.5 is reachable ONLY through the created_at level.
    expect(state.positions[0].avg_cost).toBeCloseTo(162.5, 10)
    expect(state.positions[0].total_invested).toBeCloseTo(2600, 10)
  })

  it('propagates a corrupt cash amount instead of silently skipping it', () => {
    expect(() =>
      replayPortfolioAt([], [{ type: 'DEPOSITO', amount: NaN, date: '2022-02-01' }], '2022-02-09')
    ).toThrow(/non-numeric amount/)
  })
})
