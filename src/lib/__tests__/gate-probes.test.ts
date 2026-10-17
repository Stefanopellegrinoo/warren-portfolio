/**
 * The S4 re-verify probes (P*: round 2, Q*: round 3) as permanent tests: real deriveHistory + knownAtFrom + evaluateGate over
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
const ON = tx({ ticker: 'XD', asset_type: 'ON', quantity: 10000, price: 1 })
const ONMV = mv({ type: 'COMPRA', amount: 10000 })
const MARKET = 1.08 // ONs held at market: value = invested x 1.08
function truthAt(input: any, D: string, ratio = 1) {
  const cutoff = Date.parse(`${next(D)}T02:00:00Z`)
  const seen = (rows: any[]) => rows.filter(r => !r.created_at || Date.parse(r.created_at) <= cutoff).map(r => (r.date.slice(0, 10) > D ? { ...r, date: D } : r))
  const { rows } = deriveHistory({ ...input, transactions: seen(input.transactions), movements: seen(input.movements), today: next(D) })
  const r = rows.find((x: any) => x.snapshot_date === D)!
  const ons = r.ons_invested * ratio
  return { ...r, ons_value: ons, total_value: r.stocks_value + r.cash_value + ons }
}
const snapsFrom = (input: any, over: Record<string, any> = {}, ratio = (_d: string) => 1) =>
  DATES.map(D => ({ id: D, ...truthAt(input, D, ratio(D)), source: 'live', ...(over[D] ?? {}) })) as any[]
const marksOf = (snaps: any[]) => new Map(snaps.map(s => [s.snapshot_date, { ons_value: s.ons_value, ons_invested: s.ons_invested }]))
/** The wiring's shape: marks come from the live snapshots under comparison. */
const withMarks = (txs: any[], movs: any[], ratio = (_d: string) => MARKET) => {
  const snaps = snapsFrom(baseInput(txs, movs), {}, ratio)
  return { snaps, input: baseInput(txs, movs, { onMarks: marksOf(snaps) }) }
}
function gate(input: DeriveInput, snapshots: any[], bend?: (rows: any[]) => any[]) {
  const { rows, flags } = deriveHistory(input)
  return evaluateGate({ today: TODAY, derived: bend ? bend(rows) : rows, snapshots, liveTotal: rows.at(-1)!.total_value, onRecordedDates: flags.onRecordedDates, knownAt: knownAtFrom(input) })
}
const diff = (r: any, date: string) => r.diffs.find((x: any) => x.date === date)

describe('S4 re-verify probes (P*: round 2, Q*: round 3)', () => {
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

  it('P6: a late ON buy + aggregate marks is NOT explained as late-loaded (no circular marks in knownAt)', () => {
    const late = '2026-08-07T15:00:00Z'
    const txs = [tx(), tx({ ticker: 'XD', asset_type: 'ON', quantity: 10000, price: 1, date: '2026-07-31' }), tx({ ticker: 'YD', asset_type: 'ON', quantity: 5000, price: 1, date: '2026-08-04', created_at: late })]
    const movs = [mv(), mv({ type: 'COMPRA', amount: 3000 }), mv({ type: 'COMPRA', amount: 10000 }), mv({ type: 'COMPRA', amount: 5000, date: '2026-08-04', created_at: late })]
    const { snaps, input } = withMarks(txs, movs)
    const r = gate(input, snaps)
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

  const late = '2026-08-06T15:00:00Z'

  it('Q1: a late-loaded stock trade while ONs are held at market passes G1 and G2', () => {
    const txs = [tx(), ON, tx({ ticker: 'BBB', quantity: 10, price: 199, date: '2026-08-05', created_at: late })]
    const movs = [mv(), mv({ type: 'COMPRA', amount: 3000 }), ONMV, mv({ type: 'COMPRA', amount: 1990, date: '2026-08-05', created_at: late })]
    const { snaps, input } = withMarks(txs, movs)
    const r = gate(input, snaps)
    expect(diff(r, '2026-08-05').reasons).toMatchObject({ stocksCash: 'late-loaded', total: 'late-loaded', ons: null })
    expect(r.checks.G1.pass).toBe(true)
    expect(r.checks.G2.pass).toBe(true)
  })

  it('Q3: an 08-04 evening sale (date-shift) while ONs are held at market passes G1 and G2', () => {
    const ev = '2026-08-05T00:30:00Z'
    const txs = [tx(), ON, tx({ operation: 'VENTA', price: 52, date: '2026-08-05', created_at: ev })]
    const movs = [mv(), mv({ type: 'COMPRA', amount: 3000 }), ONMV, mv({ type: 'VENTA', amount: 5200, date: '2026-08-05', created_at: ev }), mv({ type: 'RETIRO', amount: 4000, date: '2026-08-05', created_at: ev })]
    const { snaps, input } = withMarks(txs, movs)
    const r = gate(input, snaps)
    expect(diff(r, '2026-08-04').reasons).toMatchObject({ stocksCash: 'date-shift', total: 'date-shift' })
    expect(r.checks.G1.pass).toBe(true)
    expect(r.checks.G2.pass).toBe(true)
  })

  it('Q4: derived ONs x100 on one date (stocks and cash right) fail G2: the total is not excused on its own', () => {
    const { snaps, input } = withMarks([tx(), ON], [mv(), mv({ type: 'COMPRA', amount: 3000 }), ONMV])
    const bend = (rows: any[]) => rows.map(r => (r.snapshot_date === '2026-08-05' ? { ...r, ons_value: r.ons_value * 100, total_value: r.total_value + r.ons_value * 99 } : r))
    const r = gate(input, snaps, bend)
    expect(diff(r, '2026-08-05').reasons).toMatchObject({ stocksCash: null, ons: 'unexplained', total: 'unexplained' })
    expect(r.checks.G2.pass).toBe(false)
    expect(r.pass).toBe(false)
  })

  it('Q5: a held ON with no recorded close and a mark that misses the cost basis by $2 cannot satisfy G4', () => {
    const txs = [tx(), ON]
    const movs = [mv(), mv({ type: 'COMPRA', amount: 3000 }), ONMV]
    const snaps = snapsFrom(baseInput(txs, movs), {}, () => MARKET).map(s => ({ ...s, ons_invested: s.ons_invested + 2 }))
    const input = baseInput(txs, movs, { onMarks: marksOf(snaps) })
    const { rows, flags } = deriveHistory(input)
    expect(rows.slice(0, -1).every(r => r.source === 'estimated')).toBe(true)
    expect(flags.onRecordedDates).toEqual([])
    const r = gate(input, snaps)
    expect(r.checks.G4.pass).toBe(false)
    expect(r.pass).toBe(false)
  })

  it('Q6: a retroactive ON buy after usable marks is valued at cost, not cost x the old ratio (S7.3)', () => {
    const txs = [tx(), ON, tx({ ticker: 'YD', asset_type: 'ON', quantity: 2000, price: 1, date: '2026-08-04', created_at: '2026-08-07T15:00:00Z' })]
    const movs = [mv(), mv({ type: 'COMPRA', amount: 3000 }), ONMV, mv({ type: 'COMPRA', amount: 2000, date: '2026-08-04', created_at: '2026-08-07T15:00:00Z' })]
    const marks = new Map(DATES.map(d => [d, { ons_value: 10800, ons_invested: 10000 }]))
    const r = deriveHistory(baseInput(txs, movs, { onMarks: marks })).rows.find(x => x.snapshot_date === '2026-08-05')!
    expect(r.ons_invested).toBe(12000)
    expect(r.ons_value).toBeCloseTo(12000, 6)
    expect(r.source).toBe('estimated')
  })

  it('real 07-23 replica: a null-breakdown snapshot between cost-marked estimated days and a market live day is skipped, listed, and does not touch the gate', () => {
    const txs = [tx(), ON]
    const movs = [mv(), mv({ type: 'COMPRA', amount: 3000 }), ONMV]
    const C = '2026-08-05'
    const ratio = (d: string) => (d < C ? 1 : MARKET)
    const nullRow = { stocks_value: null, ons_value: null, cash_value: null, ons_invested: null, stocks_invested: null }
    const snaps = snapsFrom(baseInput(txs, movs), {}, ratio).map(s => (s.snapshot_date < C ? { ...s, source: 'estimated' } : s.snapshot_date === C ? { ...s, ...nullRow } : s))
    const marks = marksOf(snaps.filter(s => s.source === 'live' && s.snapshot_date !== C))
    const r = gate(baseInput(txs, movs, { onMarks: marks }), snaps)
    expect(r.skippedNoBreakdown).toEqual([C])
    expect(r.diffs.find(d => d.date === C)).toBeUndefined()
    expect(r.checks.G1.pass).toBe(true)
    expect(r.checks.G2.pass).toBe(true)
  })
})
