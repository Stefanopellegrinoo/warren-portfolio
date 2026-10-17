/**
 * The S4 re-verify probes as permanent tests: real deriveHistory + knownAtFrom + evaluateGate over
 * synthetic ledgers, with the wiring's real column shape (movements carry created_at).
 * "Snapshot truth" for D = deriveHistory over the rows created <= D+1T02:00Z, future-dated rows counted at D.
 */
import { describe, it, expect } from 'vitest'
import { deriveHistory, knownAtFrom, knownLedgerAt, type DeriveInput } from '../derive-history'
import { evaluateGate } from '../derive-gate'

const DATES = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-10', '2026-08-11']
const TODAY = '2026-08-12'
const bars = (base: number) => DATES.map((d, i) => ({ date: d, close: base + i }))
const next = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
const tx = (o: any = {}) => ({ ticker: 'AAA', operation: 'COMPRA', quantity: 100, price: 30, commission: 0, date: '2026-07-31', asset_type: 'ACCION', created_at: '2026-07-31T15:00:00Z', ...o })
const mv = (o: any = {}) => ({ type: 'DEPOSITO', amount: 100000, date: '2026-07-31', created_at: '2026-07-31T15:00:00Z', ...o })

function baseInput(txs: any[], movs: any[], extra: any = {}): DeriveInput {
  return {
    userId: 'u1', transactions: txs, movements: movs,
    barsByTicker: new Map([['AAA', bars(50)], ['BBB', bars(200)]]),
    onPricesByTicker: new Map(), onMarks: new Map(), today: TODAY, todayQuotes: new Map(), ...extra,
  }
}
function truthAt(input: any, D: string) {
  const cutoff = Date.parse(`${next(D)}T02:00:00Z`)
  const seen = (rows: any[]) => rows.filter(r => !r.created_at || Date.parse(r.created_at) <= cutoff).map(r => (r.date.slice(0, 10) > D ? { ...r, date: D } : r))
  const { rows } = deriveHistory({ ...input, transactions: seen(input.transactions), movements: seen(input.movements), today: next(D) })
  return rows.find((r: any) => r.snapshot_date === D)!
}
const snapsFrom = (input: any, over: Record<string, any> = {}) =>
  DATES.map(D => ({ id: D, ...truthAt(input, D), source: 'live', ...(over[D] ?? {}) })) as any[]
function gate(input: DeriveInput, snapshots: any[], extra: any = {}) {
  const { rows, flags } = deriveHistory(input)
  return evaluateGate({ today: TODAY, derived: rows, snapshots, liveTotal: rows.at(-1)!.total_value, onPriceDates: [], onMarkDates: flags.onAggregateMarkDates, knownAt: knownAtFrom(input), ...extra })
}
const diff = (r: any, date: string) => r.diffs.find((x: any) => x.date === date)

describe('S4 re-verify probes', () => {
  it('P1: an 08-04 evening sale + VENTA + RETIRO (created 00:30Z D+1) is explained as date-shift', () => {
    const ev = '2026-08-05T00:30:00Z'
    const txs = [tx(), tx({ operation: 'VENTA', price: 52, date: '2026-08-05', created_at: ev })]
    const movs = [mv(), mv({ type: 'COMPRA', amount: 3000 }), mv({ type: 'VENTA', amount: 5200, date: '2026-08-05', created_at: ev }), mv({ type: 'RETIRO', amount: 4000, date: '2026-08-05', created_at: ev })]
    const input = baseInput(txs, movs)
    const r = gate(input, snapsFrom(input))
    expect(diff(r, '2026-08-04').reasons.stocksCash).toBe('date-shift')
    expect(r.checks.G1.pass).toBe(true)
    expect(r.checks.G2.pass).toBe(true)
  })

  it('P2: a late-loaded trade with its COMPRA movement is explained as late-loaded', () => {
    const late = '2026-08-06T15:00:00Z'
    const txs = [tx(), tx({ ticker: 'BBB', quantity: 10, price: 199, date: '2026-08-05', created_at: late })]
    const movs = [mv(), mv({ type: 'COMPRA', amount: 3000 }), mv({ type: 'COMPRA', amount: 1990, date: '2026-08-05', created_at: late })]
    const input = baseInput(txs, movs)
    const r = gate(input, snapsFrom(input))
    expect(diff(r, '2026-08-05').reasons.stocksCash).toBe('late-loaded')
    expect(r.checks.G1.pass).toBe(true)
    expect(r.checks.G2.pass).toBe(true)
  })

  it('P4: an ESTIMATED corrupt snapshot cannot hide a +$50k stocks error', () => {
    const input = baseInput([tx()], [mv(), mv({ type: 'COMPRA', amount: 3000 })])
    const snaps = snapsFrom(input, { '2026-08-06': { source: 'estimated', stocks_value: 0, ons_value: 0, cash_value: 0, total_value: 99999 } })
    const { rows } = deriveHistory(input)
    const bent = rows.map(r => (r.snapshot_date === '2026-08-06' ? { ...r, stocks_value: r.stocks_value + 50000, total_value: r.total_value + 50000 } : r))
    const r = evaluateGate({ today: TODAY, derived: bent, snapshots: snaps, liveTotal: rows.at(-1)!.total_value, onPriceDates: [], onMarkDates: [], knownAt: knownAtFrom(input) })
    expect(diff(r, '2026-08-06').reasons.stocksCash).toBe('unexplained')
    expect(r.checks.G1.pass).toBe(false)
    expect(r.pass).toBe(false)
  })

  describe('P5: the 07-23 replica (live corrupt row: components 0, total = truth with ONs at market 10,800 vs cost 10,000)', () => {
    const txs = [tx(), tx({ ticker: 'XD', asset_type: 'ON', quantity: 10000, price: 1, date: '2026-07-31' })]
    const movs = [mv(), mv({ type: 'COMPRA', amount: 3000 }), mv({ type: 'COMPRA', amount: 10000 })]
    const marksWithCorrupt = (corruptDate: string) => {
      const m = new Map(DATES.map(d => [d, { ons_value: 10800, ons_invested: 10000 }]))
      m.set(corruptDate, { ons_value: 0, ons_invested: 0 }) // the corrupt row is also the mark source
      return m
    }
    const corruptOf = (snaps: any[], date: string) => {
      const s = snaps.find(x => x.snapshot_date === date)
      Object.assign(s, { total_value: s.stocks_value + s.cash_value + 10800, stocks_value: 0, ons_value: 0, cash_value: 0, ons_invested: 0 })
    }

    it('with a previous valid mark there is no fake dip: the ON carries the previous ratio, the row is estimated, the gate passes G1/G2', () => {
      const clean = baseInput(txs, movs, { onMarks: new Map(DATES.map(d => [d, { ons_value: 10800, ons_invested: 10000 }])) })
      const snaps = snapsFrom(clean)
      corruptOf(snaps, '2026-08-04')
      const input = baseInput(txs, movs, { onMarks: marksWithCorrupt('2026-08-04') })
      const { rows } = deriveHistory(input)
      const d = rows.find(x => x.snapshot_date === '2026-08-04')!
      expect(d.ons_value).toBeCloseTo(10800, 6)
      expect(d.source).toBe('estimated')
      const r = gate(input, snaps)
      expect(Math.abs(diff(r, '2026-08-04').dTotal)).toBeLessThanOrEqual(1)
      expect(diff(r, '2026-08-04').reasons).toMatchObject({ stocksCash: 'corrupt-snapshot', ons: 'corrupt-snapshot', total: null })
      expect(r.checks.G1.pass).toBe(true)
      expect(r.checks.G2.pass).toBe(true)
      expect(r.corruptDates).toEqual(['2026-08-04'])
    })

    it('with NO previous valid mark the dip is reported as corrupt-snapshot on the total, never silently, and G1 fails on the components', () => {
      const clean = baseInput(txs, movs, { onMarks: new Map(DATES.map(d => [d, { ons_value: 10800, ons_invested: 10000 }])) })
      const snaps = snapsFrom(clean)
      corruptOf(snaps, '2026-08-03')
      const input = baseInput(txs, movs, { onMarks: marksWithCorrupt('2026-08-03') })
      const r = gate(input, snaps)
      const d = diff(r, '2026-08-03')
      expect(d.dTotal).toBeCloseTo(-800, 6)
      expect(d.reasons.total).toBe('corrupt-snapshot')
      expect(d.reasons.stocksCash).toBe('unexplained')
      expect(r.checks.G1.pass).toBe(false)
    })
  })

  it('P6: a late ON buy + aggregate marks is NOT explained as late-loaded (no circular marks in knownAt)', () => {
    const late = '2026-08-07T15:00:00Z'
    const txs = [tx(), tx({ ticker: 'XD', asset_type: 'ON', quantity: 10000, price: 1, date: '2026-07-31' }), tx({ ticker: 'YD', asset_type: 'ON', quantity: 5000, price: 1, date: '2026-08-04', created_at: late })]
    const movs = [mv(), mv({ type: 'COMPRA', amount: 3000 }), mv({ type: 'COMPRA', amount: 10000 }), mv({ type: 'COMPRA', amount: 5000, date: '2026-08-04', created_at: late })]
    const marks = new Map(DATES.map(d => [d, { ons_value: 10800, ons_invested: 10000 }]))
    const input = baseInput(txs, movs, { onMarks: marks })
    const r = gate(input, snapsFrom(input))
    expect(diff(r, '2026-08-05').reasons.total).toBe('unexplained')
    expect(r.checks.G2.pass).toBe(false)
    expect(r.pass).toBe(false)
  })

  it('P7: a future-dated row entered before D (created 08-03, dated 08-06) is seen by the 08-04 snapshot', () => {
    const txs = [tx(), tx({ ticker: 'BBB', quantity: 10, price: 199, date: '2026-08-06', created_at: '2026-08-03T15:00:00Z' })]
    const movs = [mv(), mv({ type: 'COMPRA', amount: 3000 }), mv({ type: 'COMPRA', amount: 1990, date: '2026-08-06', created_at: '2026-08-03T15:00:00Z' })]
    const input = baseInput(txs, movs)
    const r = gate(input, snapsFrom(input))
    expect(diff(r, '2026-08-04').reasons.stocksCash).toBe('date-shift')
    expect(r.checks.G1.pass).toBe(true)
    expect(r.checks.G2.pass).toBe(true)
  })

  it('P8: created_at compares as an instant, whatever the offset or fractional seconds', () => {
    const t = (c: string) => knownLedgerAt('2026-08-04', [tx({ date: '2026-08-05', created_at: c })] as any, []).reason
    expect(t('2026-08-05T00:30:00.123456+00:00')).toBe('date-shift')
    expect(t('2026-08-04T21:30:00-03:00')).toBe('date-shift') // 00:30Z
    expect(t('2026-08-05T01:00:00-03:00')).toBeNull() // 04:00Z: after the cutoff, not yet visible, row dated D+1 -> not late either
    expect(knownLedgerAt('2026-08-04', [tx({ date: '2026-08-04', created_at: '2026-08-05T02:00:00.5+00:00' })] as any, []).reason).toBe('late-loaded')
  })
})
