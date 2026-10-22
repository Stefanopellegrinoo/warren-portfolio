// src/lib/__tests__/derive-history.test.ts
import { describe, it, expect } from 'vitest'
import { deriveHistory, ledgerFlows, type DeriveInput } from '../derive-history'
import { computeUniverseTwr, projectHistory } from '../asset-universe'
import type { LedgerMovement, LedgerTrade } from '../ledger-core'
import type { DailyBar } from '../historical-prices'

const TODAY = '2026-03-10'

function tx(over: Partial<LedgerTrade>): LedgerTrade {
  return {
    ticker: 'AAA', operation: 'COMPRA', quantity: 10, price: 50, commission: 0,
    date: '2026-03-02', asset_type: 'ACCION', created_at: null, ...over,
  }
}
/** A row that only blows up once the core reaches its date. */
const poisoned = (date: string): LedgerTrade =>
  Object.defineProperty(tx({ date }), 'quantity', { get() { throw new Error('bad row') } })
const bars = (rows: Array<[string, number]>): DailyBar[] => rows.map(([date, close]) => ({ date, close }))
const mv = (type: string, amount: number, date: string): LedgerMovement => ({ type, amount, date })

// Mon 03-02 .. Fri 03-06, Mon 03-09
const AAA = bars([['2026-03-02', 50], ['2026-03-03', 60], ['2026-03-04', 62], ['2026-03-05', 61], ['2026-03-06', 63], ['2026-03-09', 64]])
const BASE_MOVES = [mv('DEPOSITO', 5000, '2026-03-01'), mv('COMPRA', 500, '2026-03-02')]

function input(over: Partial<DeriveInput> = {}): DeriveInput {
  return {
    userId: 'u1',
    transactions: [tx({})],
    movements: BASE_MOVES,
    schedules: new Map(),
    overrides: [],
    barsByTicker: new Map([['AAA', AAA]]),
    onPricesByTicker: new Map(),
    today: TODAY,
    todayQuotes: new Map([['AAA', { ticker: 'AAA', price: 70, change: 0, changePercent: 0, previousClose: 70 }]]),
    ...over,
  }
}
const byDate = (rows: { snapshot_date: string }[]) => new Map(rows.map(r => [r.snapshot_date, r as any]))

describe('deriveHistory — shape and calendar', () => {
  it('emits snapshot-shaped rows, without a source, that projectHistory accepts for every universe', () => {
    const { rows } = deriveHistory(input())
    for (const r of rows) {
      expect(r.user_id).toBe('u1')
      expect('source' in r).toBe(false)
      for (const k of ['total_value', 'total_invested', 'pnl', 'pnl_pct', 'stocks_value', 'stocks_invested', 'ons_value', 'ons_invested', 'cash_value'])
        expect(Number.isFinite((r as any)[k])).toBe(true)
    }
    expect(projectHistory(rows, 'total').length).toBeGreaterThan(0)
    expect(projectHistory(rows, 'stocks').length).toBeGreaterThan(0)
    expect(() => projectHistory(rows, 'ons')).not.toThrow()
  })

  it('calendar is the union of bar dates up to yesterday plus today, with no gaps or invented days', () => {
    const { rows } = deriveHistory(input())
    expect(rows.map(r => r.snapshot_date)).toEqual([
      '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-09', TODAY,
    ])
  })

  it('starts at the first ledger date: the first trade, or an earlier cash movement', () => {
    expect(deriveHistory(input({ transactions: [tx({ date: '2026-03-04' })], movements: [] })).rows[0].snapshot_date).toBe('2026-03-04')
    const early = deriveHistory(input({ transactions: [tx({ date: '2026-03-04' })], movements: [mv('DEPOSITO', 5000, '2026-03-03')] })).rows
    expect(early[0].snapshot_date).toBe('2026-03-03')
    expect(early[0].cash_value).toBeCloseTo(5000, 6)
  })

  it('never throws on bad data: returns what it has plus a failure flag', () => {
    const out = deriveHistory(input({ transactions: [null as any] }))
    expect(out.flags.failure).toMatch(/.+/)
    expect(Array.isArray(out.rows)).toBe(true)
  })

  it('a failure mid-series keeps the rows computed before it and does not throw', () => {
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

  it('today row is priced from todayQuotes', () => {
    const t = byDate(deriveHistory(input()).rows).get(TODAY)
    expect(t.stocks_value).toBeCloseTo(700, 6)
    expect(t.cash_value).toBeCloseTo(4500, 6)
  })

  it('today without a live quote falls back to the last close, and is listed as unpriced', () => {
    const { rows, flags } = deriveHistory(input({ todayQuotes: new Map() }))
    expect(byDate(rows).get(TODAY).stocks_value).toBeCloseTo(640, 6)
    expect(flags.todayUnpriced).toEqual(['AAA'])
  })

  it('a retroactive BUY lifts every later row by qty x close and lowers cash by its cost', () => {
    const H = byDate(deriveHistory(input({
      transactions: [tx({ date: '2026-03-04', quantity: 10, price: 50 })],
      movements: [mv('DEPOSITO', 5000, '2026-03-01'), mv('COMPRA', 500, '2026-03-04')],
    })).rows)
    const R = byDate(deriveHistory(input({
      transactions: [tx({ date: '2026-03-04' }), tx({ date: '2026-03-02', quantity: 10, price: 50 })],
      movements: [mv('DEPOSITO', 5000, '2026-03-01'), mv('COMPRA', 500, '2026-03-04'), mv('COMPRA', 500, '2026-03-02')],
    })).rows)
    for (const d of ['2026-03-04', '2026-03-05', '2026-03-06', '2026-03-09']) {
      const close = AAA.find(b => b.date === d)!.close
      expect(R.get(d).stocks_value - H.get(d).stocks_value).toBeCloseTo(10 * close, 6)
      expect(R.get(d).cash_value - H.get(d).cash_value).toBeCloseTo(-500, 6)
    }
  })

  it('deleting that transaction gives back exactly the original history', () => {
    const retro = input({
      transactions: [tx({}), tx({ date: '2026-03-03', quantity: 5 })],
      movements: [...BASE_MOVES, mv('COMPRA', 250, '2026-03-03')],
    })
    const H = deriveHistory(input()).rows
    expect(deriveHistory(retro).rows).not.toEqual(H)
    const restored = deriveHistory({
      ...retro,
      transactions: retro.transactions.filter(t => t.date !== '2026-03-03'),
      movements: retro.movements.filter(m => m.date !== '2026-03-03'),
    }).rows
    expect(restored).toEqual(H)
  })

  it('keeps a negative cash balance and flags the worst day instead of throwing', () => {
    const { rows, flags } = deriveHistory(input({ movements: [mv('COMPRA', 250, '2026-03-02')] }))
    expect(byDate(rows).get('2026-03-02').cash_value).toBeCloseTo(-250, 6)
    expect(flags.negativeCash).toEqual({ date: '2026-03-02', cash: -250 })
  })

  it('marks a stock with no bars at cost and lists it', () => {
    const { rows, flags } = deriveHistory(input({
      transactions: [tx({ ticker: 'ZZZ' }), tx({})],
      movements: [mv('DEPOSITO', 5000, '2026-03-01')],
    }))
    expect(byDate(rows).get('2026-03-03').stocks_value).toBeCloseTo(500 + 600, 6)
    expect(flags.costMarkedStocks).toEqual(['ZZZ'])
  })

  it('finds bars whatever the case or padding of the caller keys', () => {
    const { rows, flags } = deriveHistory(input({
      transactions: [tx({}), tx({ ticker: 'BBB' })],
      movements: [mv('DEPOSITO', 5000, '2026-03-01')],
      barsByTicker: new Map([['AAA', AAA], [' bbb ', bars([['2026-03-04', 40], ['2026-03-05', 41]])]]),
    }))
    expect(flags.costMarkedStocks).toEqual([])
    expect(byDate(rows).get('2026-03-05').stocks_value).toBeCloseTo(10 * 61 + 10 * 41, 6)
  })
})

describe('deriveHistory — valuation rule (S3): last close on or before the day, else purchase price', () => {
  const on = (over: Partial<LedgerTrade> = {}) => tx({ ticker: 'XD', asset_type: 'ON', quantity: 100, price: 100, ...over })
  const onInput = (over: Partial<DeriveInput> = {}) => input({
    transactions: [tx({}), on()],
    movements: [mv('DEPOSITO', 20000, '2026-03-01'), mv('COMPRA', 500, '2026-03-02'), mv('COMPRA', 10000, '2026-03-02')],
    onPricesByTicker: new Map([['XD', bars([['2026-03-03', 101], ['2026-03-06', 99]])]]),
    ...over,
  })

  it('an ON with no close since purchase is at its purchase price; then the last close carries forward', () => {
    const r = byDate(deriveHistory(onInput()).rows)
    expect(r.get('2026-03-02').ons_value).toBeCloseTo(10000, 6)
    expect(r.get('2026-03-03').ons_value).toBeCloseTo(10100, 6)
    expect(r.get('2026-03-05').ons_value).toBeCloseTo(10100, 6)
    expect(r.get('2026-03-09').ons_value).toBeCloseTo(9900, 6)
    expect(r.get(TODAY).ons_value).toBeCloseTo(9900, 6)
    expect(r.get('2026-03-03').ons_invested).toBeCloseTo(10000, 6)
  })

  it('a close from before the purchase is not used: the purchase price is', () => {
    const r = byDate(deriveHistory(onInput({ transactions: [tx({}), on({ date: '2026-03-04' })] })).rows)
    expect(r.get('2026-03-04').ons_value).toBeCloseTo(10000, 6)
    expect(r.get('2026-03-06').ons_value).toBeCloseTo(9900, 6)
  })
})

describe('deriveHistory — automatic ON payments from the schedule (S4)', () => {
  const on = tx({ ticker: 'XD', asset_type: 'ON', quantity: 100, price: 100 })
  const moves = [mv('DEPOSITO', 10000, '2026-03-01'), mv('COMPRA', 10000, '2026-03-02')]
  const onBars = new Map([['XD', bars([['2026-03-02', 100], ['2026-03-03', 100], ['2026-03-04', 100], ['2026-03-05', 100], ['2026-03-06', 100], ['2026-03-09', 100]])]])
  const base = (flows: Array<{ date: string; ren: number; amo: number }>, over: Partial<DeriveInput> = {}) => input({
    transactions: [on], movements: moves, barsByTicker: new Map(), onPricesByTicker: onBars,
    todayQuotes: new Map(), schedules: new Map([['XD', flows]]), ...over,
  })

  it('a coupon lands in cash on its payment date, and ON cost is unchanged', () => {
    const r = byDate(deriveHistory(base([{ date: '2026-03-05', ren: 2, amo: 0 }])).rows)
    expect(r.get('2026-03-04').cash_value).toBeCloseTo(0, 6)
    expect(r.get('2026-03-05').cash_value).toBeCloseTo(200, 6)
    expect(r.get(TODAY).cash_value).toBeCloseTo(200, 6)
    expect(r.get('2026-03-05').ons_invested).toBeCloseTo(10000, 6)
  })

  it('an amortization lands in cash and lowers ON invested by the returned share', () => {
    const r = byDate(deriveHistory(base([{ date: '2026-03-05', ren: 0, amo: 50 }])).rows)
    expect(r.get('2026-03-04').ons_invested).toBeCloseTo(10000, 6)
    expect(r.get('2026-03-05').cash_value).toBeCloseTo(5000, 6)
    expect(r.get('2026-03-05').ons_invested).toBeCloseTo(5000, 6)
  })

  it('a user override marking the coupon not received keeps it out of cash', () => {
    const r = byDate(deriveHistory(base([{ date: '2026-03-05', ren: 2, amo: 0 }], {
      overrides: [{ ticker: 'XD', date: '2026-03-05', kind: 'coupon', amount: null }],
    })).rows)
    expect(r.get('2026-03-05').cash_value).toBeCloseTo(0, 6)
  })

  it('returns the core income, which ledgerFlows routes as CUPON income and ON VENTA-shaped flows', () => {
    const { income } = deriveHistory(base([{ date: '2026-03-05', ren: 2, amo: 50 }]))
    expect(ledgerFlows(income)).toEqual({
      income: [{ date: '2026-03-05', type: 'CUPON', amount: 200 }],
      transactions: [{ date: '2026-03-05', operation: 'VENTA', quantity: 1, price: 5000, commission: 0, asset_type: 'ON' }],
    })
  })

  it('a coupon does not read as a gain in the measurable TWR once declared through ledgerFlows', () => {
    const { rows, income } = deriveHistory(base([{ date: '2026-03-05', ren: 2, amo: 0 }], {
      movements: [mv('DEPOSITO', 11000, '2026-03-01'), mv('COMPRA', 10000, '2026-03-02')],
    }))
    const flows = ledgerFlows(income)
    const inputs = { externalFlows: [], transactions: [], income: flows.income }
    const declared = computeUniverseTwr(rows.slice(0, -1), 'measurable', inputs)
    const undeclared = computeUniverseTwr(rows.slice(0, -1), 'measurable', { ...inputs, income: [] })
    expect(declared.series.at(-1)!.twrIndex).toBeCloseTo(1, 9)
    expect(undeclared.series.at(-1)!.twrIndex).toBeGreaterThan(1.1)
  })
})
