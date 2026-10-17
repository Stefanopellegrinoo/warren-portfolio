import { describe, it, expect } from 'vitest'
import * as deriveHistoryModule from '../derive-history'
import { knownAtFrom, knownLedgerAt, type DeriveInput } from '../derive-history'
import type { ReplayMovement, ReplayTransaction } from '../portfolio-replay'

const tx = (over: Partial<ReplayTransaction> = {}): ReplayTransaction => ({
  ticker: 'ZZZ', operation: 'COMPRA', quantity: 1, price: 10, commission: 0,
  date: '2026-03-02', asset_type: 'ACCION', created_at: '2026-03-02T15:00:00Z', ...over,
})
const mv = (over: Partial<ReplayMovement> = {}): ReplayMovement => ({
  type: 'DEPOSITO', amount: 100, date: '2026-03-02', created_at: '2026-03-02T15:00:00Z', ...over,
})

describe('knownLedgerAt: the ledger as the 02:00Z snapshot of D+1 saw it', () => {
  it('changes nothing (reason null) when every row was known in time', () => {
    const k = knownLedgerAt('2026-03-05', [tx()], [mv()])
    expect(k.reason).toBeNull()
    expect(k.transactions).toEqual([tx()])
    expect(k.movements).toEqual([mv()])
  })

  it('late-loaded: drops a tx dated <= D inserted after the cutoff, keeps one inserted right at it', () => {
    const late = tx({ date: '2026-03-05', created_at: '2026-03-06T02:00:01Z' })
    const onTime = tx({ date: '2026-03-05', created_at: '2026-03-06T02:00:00Z' })
    const k = knownLedgerAt('2026-03-05', [late, onTime], [])
    expect(k.reason).toBe('late-loaded')
    expect(k.transactions).toEqual([onTime])
  })

  it('late-loaded also drops cash movements', () => {
    const late = mv({ date: '2026-03-04', created_at: '2026-03-09T12:00:00Z' })
    const k = knownLedgerAt('2026-03-05', [tx()], [late])
    expect(k.reason).toBe('late-loaded')
    expect(k.movements).toEqual([])
  })

  it('date-shift: a row dated D+1 entered the evening of D (Argentina) is re-dated to D', () => {
    const evening = tx({ date: '2026-03-06', created_at: '2026-03-06T00:30:00Z' })
    const k = knownLedgerAt('2026-03-05', [evening], [])
    expect(k.reason).toBe('date-shift')
    expect(k.transactions[0].date).toBe('2026-03-05')
    // the input is never mutated
    expect(evening.date).toBe('2026-03-06')
  })

  it('a future-dated row entered long before D is left alone', () => {
    const earlier = tx({ date: '2026-03-06', created_at: '2026-03-04T12:00:00Z' })
    const k = knownLedgerAt('2026-03-05', [earlier], [])
    expect(k.reason).toBeNull()
    expect(k.transactions[0].date).toBe('2026-03-06')
  })

  it('a row without created_at counts as known', () => {
    const k = knownLedgerAt('2026-03-05', [tx({ created_at: undefined })], [])
    expect(k.reason).toBeNull()
    expect(k.transactions).toHaveLength(1)
  })
})

describe('knownAtFrom: deriveHistory over the ledger a snapshot could have known', () => {
  const bar = (date: string, close: number) => ({ date, close })
  const AAA = [bar('2026-03-02', 50), bar('2026-03-03', 60), bar('2026-03-04', 62), bar('2026-03-05', 61), bar('2026-03-06', 63)]
  const base = (extra: ReplayTransaction[]): DeriveInput => ({
    userId: 'u1',
    transactions: [tx({ ticker: 'AAA', quantity: 10, price: 50, date: '2026-03-02' }), ...extra],
    movements: [mv({ date: '2026-03-01', amount: 5000 })],
    barsByTicker: new Map([['AAA', AAA]]),
    onPricesByTicker: new Map(), onMarks: new Map(),
    today: '2026-03-09', todayQuotes: new Map(),
  })

  it('returns null when the ledger was fully known (nothing to explain with)', () => {
    expect(knownAtFrom(base([]))('2026-03-04')).toBeNull()
  })

  it('late-loaded: values D without the row that arrived afterwards', () => {
    const late = tx({ ticker: 'AAA', quantity: 5, price: 50, date: '2026-03-03', created_at: '2026-03-08T12:00:00Z' })
    const known = knownAtFrom(base([late]))('2026-03-04')
    expect(known?.reason).toBe('late-loaded')
    expect(known?.row.snapshot_date).toBe('2026-03-04')
    expect(known?.row.stocks_value).toBeCloseTo(10 * 62, 6)
  })

  it('date-shift: values D with the evening entry dated D+1', () => {
    const evening = tx({ ticker: 'AAA', quantity: 5, price: 50, date: '2026-03-05', created_at: '2026-03-05T00:30:00Z' })
    const known = knownAtFrom(base([evening]))('2026-03-04')
    expect(known?.reason).toBe('date-shift')
    expect(known?.row.stocks_value).toBeCloseTo(15 * 62, 6)
  })

  it('has no misprice concept: it only ever dirtied cost and P&L, never value', () => {
    expect('MISPRICED_TICKERS' in deriveHistoryModule).toBe(false)
  })
})
