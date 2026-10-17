// src/lib/__tests__/derive-history.test.ts
import { describe, it, expect } from 'vitest'
import { deriveHistory, type DeriveInput } from '../derive-history'
import { projectHistory } from '../asset-universe'
import type { ReplayMovement, ReplayTransaction } from '../portfolio-replay'
import type { DailyBar } from '../historical-prices'

const TODAY = '2026-03-10'

function tx(over: Partial<ReplayTransaction>): ReplayTransaction {
  return {
    ticker: 'AAA', operation: 'COMPRA', quantity: 10, price: 50, commission: 0,
    date: '2026-03-02', asset_type: 'ACCION', created_at: null, ...over,
  }
}
/** A row that only blows up once the replay reaches its date. */
const poisoned = (date: string): ReplayTransaction =>
  Object.defineProperty(tx({ date }), 'quantity', { get() { throw new Error('bad row') } })
const bars = (rows: Array<[string, number]>): DailyBar[] => rows.map(([date, close]) => ({ date, close }))
const mv = (type: string, amount: number, date: string): ReplayMovement => ({ type, amount, date })

// Mon 03-02 .. Fri 03-06, Mon 03-09
const AAA = bars([['2026-03-02', 50], ['2026-03-03', 60], ['2026-03-04', 62], ['2026-03-05', 61], ['2026-03-06', 63], ['2026-03-09', 64]])
const BASE_MOVES = [mv('DEPOSITO', 5000, '2026-03-01'), mv('COMPRA', 500, '2026-03-02')]

function input(over: Partial<DeriveInput> = {}): DeriveInput {
  return {
    userId: 'u1',
    transactions: [tx({})],
    movements: BASE_MOVES,
    barsByTicker: new Map([['AAA', AAA]]),
    onPricesByTicker: new Map(),
    onMarks: new Map(),
    today: TODAY,
    todayQuotes: new Map([['AAA', { ticker: 'AAA', price: 70, change: 0, changePercent: 0, previousClose: 70 }]]),
    ...over,
  }
}
const byDate = (rows: { snapshot_date: string }[]) => new Map(rows.map(r => [r.snapshot_date, r as any]))

describe('deriveHistory — shape and calendar', () => {
  it('S3.1 emits snapshot-shaped rows that projectHistory accepts for every universe', () => {
    const { rows } = deriveHistory(input())
    for (const r of rows) {
      expect(r).toMatchObject({ user_id: 'u1', source: expect.stringMatching(/live|estimated/) })
      for (const k of ['total_value', 'total_invested', 'pnl', 'pnl_pct', 'stocks_value', 'stocks_invested', 'ons_value', 'ons_invested', 'cash_value'])
        expect(Number.isFinite((r as any)[k])).toBe(true)
    }
    expect(projectHistory(rows, 'total').length).toBeGreaterThan(0)
    expect(projectHistory(rows, 'stocks').length).toBeGreaterThan(0)
    expect(() => projectHistory(rows, 'ons')).not.toThrow()
  })

  it('S4.2 calendar is the union of bar dates up to yesterday plus today, with no gaps or invented days', () => {
    const { rows } = deriveHistory(input())
    expect(rows.map(r => r.snapshot_date)).toEqual([
      '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-09', TODAY,
    ])
  })

  it('starts at the first transaction, not at the first bar', () => {
    const { rows } = deriveHistory(input({ transactions: [tx({ date: '2026-03-04' })] }))
    expect(rows[0].snapshot_date).toBe('2026-03-04')
  })

  it('S3.2 never throws on bad data: returns what it has plus a failure flag', () => {
    const out = deriveHistory(input({ transactions: [null as any] }))
    expect(out.flags.failure).toMatch(/.+/)
    expect(Array.isArray(out.rows)).toBe(true)
  })

  it('S3.2 a failure mid-series keeps the rows computed before it and does not throw', () => {
    const out = deriveHistory(input({ transactions: [tx({}), poisoned('2026-03-05')] }))
    expect(out.flags.failure).toMatch(/.+/)
    expect(out.rows.map(r => r.snapshot_date)).toEqual(['2026-03-02', '2026-03-03', '2026-03-04'])
  })
})

describe('deriveHistory — hand-computed values', () => {
  it('values stocks at the bar close and cash from the ledger', () => {
    const r = byDate(deriveHistory(input()).rows).get('2026-03-03')
    expect(r.stocks_value).toBeCloseTo(600, 6)
    expect(r.stocks_invested).toBeCloseTo(500, 6)
    expect(r.cash_value).toBeCloseTo(4500, 6)
    expect(r.total_value).toBeCloseTo(5100, 6)
    expect(r.pnl).toBeCloseTo(100, 6)
  })

  it('today row is source live, priced from todayQuotes', () => {
    const rows = byDate(deriveHistory(input()).rows)
    const t = rows.get(TODAY)
    expect(t.source).toBe('live')
    expect(t.stocks_value).toBeCloseTo(700, 6)
    expect(t.cash_value).toBeCloseTo(4500, 6)
  })

  it('S5.1 a retroactive BUY lifts every later row by qty x close and lowers cash by its cost', () => {
    const H = byDate(deriveHistory(input({
      transactions: [tx({ date: '2026-03-04', quantity: 10, price: 50 })],
      movements: [mv('DEPOSITO', 5000, '2026-03-01'), mv('COMPRA', 500, '2026-03-04')],
    })).rows)
    const R = byDate(deriveHistory(input({
      transactions: [tx({ date: '2026-03-04' }), tx({ date: '2026-03-02', quantity: 10, price: 50 })],
      movements: [mv('DEPOSITO', 5000, '2026-03-01'), mv('COMPRA', 500, '2026-03-04'), mv('COMPRA', 500, '2026-03-02')],
    })).rows)
    for (const d of ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-09']) {
      const close = AAA.find(b => b.date === d)!.close
      const before = H.get(d)
      const after = R.get(d)
      const stocksBefore = before ? before.stocks_value : 0
      const cashBefore = before ? before.cash_value : 5000
      expect(after.stocks_value - stocksBefore).toBeCloseTo(10 * close, 6)
      expect(after.cash_value - cashBefore).toBeCloseTo(-500, 6)
    }
  })

  it('S5.2 deleting that transaction gives back exactly the original history', () => {
    const base = () => input()
    const retro = () => input({
      transactions: [tx({}), tx({ date: '2026-03-03', quantity: 5 })],
      movements: [...BASE_MOVES, mv('COMPRA', 250, '2026-03-03')],
    })
    const H = deriveHistory(base()).rows
    const withExtra = deriveHistory(retro()).rows
    expect(withExtra).not.toEqual(H)
    // delete the retroactive tx (and its funding movement) from the ledger it was added to
    const afterDelete = retro()
    const restored = deriveHistory({
      ...afterDelete,
      transactions: afterDelete.transactions.filter(t => t.date !== '2026-03-03'),
      movements: afterDelete.movements.filter(m => m.date !== '2026-03-03'),
    }).rows
    expect(restored).toEqual(H)
  })

  it('S5.3 patching the quantity 10 -> 4 reprices every row since the trade', () => {
    const { rows } = deriveHistory(input({
      transactions: [tx({ quantity: 4 })],
      movements: [mv('DEPOSITO', 5000, '2026-03-01'), mv('COMPRA', 200, '2026-03-02')],
    }))
    const r = byDate(rows).get('2026-03-04')
    expect(r.stocks_value).toBeCloseTo(4 * 62, 6)
    expect(r.cash_value).toBeCloseTo(4800, 6)
  })

  it('S9.1 keeps a negative cash balance and flags the worst day instead of throwing', () => {
    const { rows, flags } = deriveHistory(input({ movements: [mv('COMPRA', 250, '2026-03-02')] }))
    expect(byDate(rows).get('2026-03-02').cash_value).toBeCloseTo(-250, 6)
    expect(flags.negativeCash).toEqual({ date: '2026-03-02', cash: -250 })
  })

  it('marks a stock with no bars at cost and lists it, without degrading the series', () => {
    const { rows, flags } = deriveHistory(input({
      transactions: [tx({ ticker: 'ZZZ' }), tx({})],
      movements: [mv('DEPOSITO', 5000, '2026-03-01')],
    }))
    expect(byDate(rows).get('2026-03-03').stocks_value).toBeCloseTo(500 + 600, 6)
    expect(flags.costMarkedStocks).toEqual(['ZZZ'])
  })

  it('finds bars whatever the case or padding of the caller keys', () => {
    // BBB has bars, but only from 03-04: it is unpriced on 03-02/03 and the flag must not fire.
    const { flags } = deriveHistory(input({
      transactions: [tx({}), tx({ ticker: 'BBB' })],
      movements: [mv('DEPOSITO', 5000, '2026-03-01')],
      barsByTicker: new Map([['AAA', AAA], [' bbb ', bars([['2026-03-04', 40], ['2026-03-05', 41]])]]),
    }))
    expect(flags.costMarkedStocks).toEqual([])
  })

  it('classifies a ticker like the replay does: the first typed row wins, so a later ON row cannot turn a stock into an ON', () => {
    const { flags } = deriveHistory(input({
      transactions: [tx({}), tx({ ticker: 'MIX', asset_type: 'ACCION' }), tx({ ticker: 'MIX', asset_type: 'ON', date: '2026-03-03' })],
      movements: [mv('DEPOSITO', 5000, '2026-03-01')],
    }))
    expect(flags.costMarkedStocks).toEqual(['MIX'])
  })
})

describe('deriveHistory — ON valuation precedence (REQ-7)', () => {
  // 100 units bought at par (price 100): cost 10,000. Value = qty x recorded close.
  const onTx = tx({ ticker: 'AERBD', asset_type: 'ON', quantity: 100, price: 100, date: '2026-03-02' })
  const onMoves = [mv('DEPOSITO', 20000, '2026-03-01'), mv('COMPRA', 10000, '2026-03-02')]
  const onInput = (over: Partial<DeriveInput> = {}) => input({
    transactions: [onTx], movements: onMoves, barsByTicker: new Map([['AAA', AAA]]), todayQuotes: new Map(), ...over,
  })
  const get = (rows: any[], d: string) => byDate(rows).get(d)

  it('S7.1 a recorded close values the ON at close x quantity and keeps the day live', () => {
    const { rows } = deriveHistory(onInput({ onPricesByTicker: new Map([['AERBD', bars([['2026-03-02', 101.95]])]]) }))
    const r = get(rows, '2026-03-03')
    expect(r.ons_value).toBeCloseTo(10195, 6)
    expect(r.source).toBe('live')
  })

  it('S7.2 with no recorded price a live aggregate mark within $1 of the replayed cost basis is used', () => {
    const { rows, flags } = deriveHistory(onInput({ onMarks: new Map([['2026-03-03', { ons_value: 10150, ons_invested: 10000.5 }]]) }))
    const r = get(rows, '2026-03-03')
    expect(r.ons_value).toBeCloseTo(10150, 6)
    expect(r.source).toBe('live')
    expect(r.total_value).toBeCloseTo(r.stocks_value + 10150 + r.cash_value, 6)
    expect(r.pnl).toBeCloseTo(r.stocks_value - r.stocks_invested + 150, 6)
    expect(flags.onAggregateMarkDates).toEqual(['2026-03-03'])
  })

  it('S7.3 when the replayed ON cost basis disagrees with the mark, the ON is held at cost and the day is estimated', () => {
    const { rows } = deriveHistory(onInput({ onMarks: new Map([['2026-03-03', { ons_value: 10150, ons_invested: 8000 }]]) }))
    const r = get(rows, '2026-03-03')
    expect(r.ons_value).toBeCloseTo(10000, 6)
    expect(r.source).toBe('estimated')
  })

  it('W1: a mark that disagrees with the replayed cost carries the previous usable mark ratio, estimated, not a mark date', () => {
    // 03-03 usable (10,300 / 10,000 = 1.03); 03-04 is a corrupt snapshot (0 / 0); 03-05 usable again
    const marks = new Map([
      ['2026-03-03', { ons_value: 10300, ons_invested: 10000 }],
      ['2026-03-04', { ons_value: 0, ons_invested: 0 }],
      ['2026-03-05', { ons_value: 10300, ons_invested: 10000 }],
    ])
    const { rows, flags } = deriveHistory(onInput({ onMarks: marks }))
    const r = get(rows, '2026-03-04')
    expect(r.ons_value).toBeCloseTo(10300, 6)
    expect(r.total_value).toBeCloseTo(r.stocks_value + 10300 + r.cash_value, 6)
    expect(r.source).toBe('estimated')
    expect(flags.onAggregateMarkDates).toEqual(['2026-03-03', '2026-03-05'])
  })

  it('S7.4 without any mark the ON is at cost and estimated', () => {
    const r = get(deriveHistory(onInput()).rows, '2026-03-03')
    expect(r.ons_value).toBeCloseTo(10000, 6)
    expect(r.source).toBe('estimated')
  })

  it('S7.5 a recorded price wins over an aggregate mark that would pass the guard', () => {
    const { rows } = deriveHistory(onInput({
      onPricesByTicker: new Map([['AERBD', bars([['2026-03-03', 102]])]]),
      onMarks: new Map([['2026-03-03', { ons_value: 10150, ons_invested: 10000 }]]),
    }))
    expect(get(rows, '2026-03-03').ons_value).toBeCloseTo(10200, 6)
  })

  it('S7.6 a price recorded on a later date leaves the earlier dates at cost and estimated', () => {
    const { rows } = deriveHistory(onInput({ onPricesByTicker: new Map([['AERBD', bars([['2026-03-05', 101]])]]) }))
    expect(get(rows, '2026-03-04').source).toBe('estimated')
    expect(get(rows, '2026-03-04').ons_value).toBeCloseTo(10000, 6)
    expect(get(rows, '2026-03-05').ons_value).toBeCloseTo(10100, 6)
    expect(get(rows, '2026-03-05').source).toBe('live')
  })

  it('S7.7 a coupon credits cash and leaves ON value and cost untouched', () => {
    const base = get(deriveHistory(onInput()).rows, '2026-03-06')
    const withCoupon = get(deriveHistory(onInput({ movements: [...onMoves, mv('CUPON', 100, '2026-03-04')] })).rows, '2026-03-06')
    expect(withCoupon.cash_value - base.cash_value).toBeCloseTo(100, 6)
    expect(withCoupon.ons_value).toBeCloseTo(base.ons_value, 6)
    expect(withCoupon.ons_invested).toBeCloseTo(base.ons_invested, 6)
  })

  it('S7.7 an amortization booked as a VENTA at par credits cash and shrinks the position', () => {
    const { rows } = deriveHistory(onInput({
      transactions: [onTx, tx({ ticker: 'AERBD', asset_type: 'ON', operation: 'VENTA', quantity: -20, price: 100, date: '2026-03-04' })],
      movements: [...onMoves, mv('VENTA', 2000, '2026-03-04')],
    }))
    const r = get(rows, '2026-03-05')
    expect(r.ons_invested).toBeCloseTo(8000, 6)
    expect(r.ons_value).toBeCloseTo(8000, 6)
    expect(r.cash_value).toBeCloseTo(20000 - 10000 + 2000, 6)
  })
})
