import { describe, it, expect } from 'vitest'
import * as deriveHistoryModule from '../derive-history'
import { evaluateGate, isCorruptSnapshot, type GateInput, type KnownAt } from '../derive-gate'
import type { DerivedRow } from '../derive-history'
import type { PortfolioSnapshot } from '@/types'

const TODAY = '2026-03-20'

function derived(date: string, over: Partial<DerivedRow> = {}): DerivedRow {
  return {
    user_id: 'u1', snapshot_date: date, total_value: 1000, total_invested: 900, pnl: 100, pnl_pct: 0.11,
    stocks_value: 600, stocks_invested: 500, ons_value: 100, ons_invested: 100, cash_value: 300,
    source: 'live', ...over,
  }
}
function snap(date: string, over: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
  return {
    id: date, user_id: 'u1', snapshot_date: date, total_value: 1000, total_invested: 900, pnl: 100, pnl_pct: 0.11,
    source: 'live', stocks_value: 600, stocks_invested: 500, ons_value: 100, ons_invested: 100, cash_value: 300, ...over,
  }
}
const dates = ['2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-16', '2026-03-17']

function input(over: Partial<GateInput> = {}): GateInput {
  return {
    today: TODAY,
    derived: [...dates.map(d => derived(d)), derived(TODAY, { total_value: 1010 })],
    snapshots: dates.map(d => snap(d)),
    liveTotal: 1010,
    onPriceDates: dates,
    onMarkDates: [],
    ...over,
  }
}
const replace = (rows: DerivedRow[], date: string, over: Partial<DerivedRow>) =>
  rows.map(r => (r.snapshot_date === date ? { ...r, ...over } : r))
const known = (over: Partial<DerivedRow>, reason: KnownAt['reason'] = 'late-loaded') =>
  (date: string): KnownAt => ({ row: derived(date, over), reason })

describe('evaluateGate', () => {
  it('passes when derived equals the measured series, today matches and 5+ ON dates agree', () => {
    const r = evaluateGate(input())
    expect(r.checks.G1.pass).toBe(true)
    expect(r.checks.G2.pass).toBe(true)
    expect(r.checks.G3.pass).toBe(true)
    expect(r.checks.G4.pass).toBe(true)
    expect(r.pass).toBe(true)
  })

  it('G1 fails on an unexplained stocks+cash diff above $1, and tolerates $1', () => {
    const base = input()
    const bad = evaluateGate({ ...base, derived: replace(base.derived, '2026-03-10', { stocks_value: 603 }) })
    expect(bad.checks.G1.pass).toBe(false)
    expect(bad.pass).toBe(false)
    expect(bad.diffs.find(d => d.date === '2026-03-10')).toMatchObject({ dStocksCash: 3, reasons: { stocksCash: 'unexplained' } })

    const edge = evaluateGate({ ...base, derived: replace(base.derived, '2026-03-10', { stocks_value: 601 }) })
    expect(edge.checks.G1.pass).toBe(true)
  })

  describe('knownAt: a ledger explanation counts only if re-deriving over what the snapshot knew matches it', () => {
    const lateDiff = (base: GateInput) => replace(base.derived, '2026-03-10', { stocks_value: 650, total_value: 1050 })

    it('explains the stocks+cash diff when knownAt(D) matches the snapshot on that component', () => {
      const base = input()
      const r = evaluateGate({ ...base, derived: lateDiff(base), knownAt: known({}) })
      expect(r.checks.G1.pass).toBe(true)
      expect(r.diffs.find(d => d.date === '2026-03-10')?.reasons.stocksCash).toBe('late-loaded')
    })

    it('does NOT explain it when knownAt(D) still disagrees with the snapshot', () => {
      const base = input()
      const r = evaluateGate({ ...base, derived: lateDiff(base), knownAt: known({ stocks_value: 640 }) })
      expect(r.checks.G1.pass).toBe(false)
    })

    it('does NOT explain it when nothing was late (knownAt returns null)', () => {
      const base = input()
      const r = evaluateGate({ ...base, derived: lateDiff(base), knownAt: () => null })
      expect(r.checks.G1.pass).toBe(false)
    })

    it('is per component: explaining stocks+cash does not excuse an ON diff', () => {
      const base = input()
      const derivedRows = replace(base.derived, '2026-03-16', { stocks_value: 650, ons_value: 104, total_value: 1054 })
      const r = evaluateGate({ ...base, derived: derivedRows, knownAt: known({ ons_value: 104, total_value: 1004 }) })
      expect(r.diffs.find(d => d.date === '2026-03-16')?.reasons).toMatchObject({ stocksCash: 'late-loaded', ons: 'unexplained' })
      expect(r.checks.G4.pass).toBe(false)
    })

    it('G2 is checked on the total component too', () => {
      const base = input()
      const r = evaluateGate({ ...base, derived: lateDiff(base), knownAt: known({ total_value: 1040 }) })
      expect(r.checks.G2.pass).toBe(false)
    })
  })

  describe('regression: the verifier probes must FAIL the gate', () => {
    it('C1: absurd +$50k stocks / +$19k ONs on every date are not excused by anything', () => {
      const base = input()
      const derivedRows = [...dates.map(x => derived(x, { stocks_value: 50600, total_value: 70000, ons_value: 19100 })), derived(TODAY, { total_value: 1010 })]
      const r = evaluateGate({ ...base, derived: derivedRows })
      expect(r.pass).toBe(false)
      expect(r.checks.G1.pass).toBe(false)
      expect(r.checks.G2.pass).toBe(false)
      expect(r.checks.G4.pass).toBe(false)
    })

    it('C2: one tiny late-loaded 2022 row cannot excuse +$9,000 cash on every date', () => {
      const base = input()
      // knownAt over the ledger minus that $1 row still has the +$9,000: it does not match the snapshot.
      const derivedRows = [...dates.map(x => derived(x, { cash_value: 9300, total_value: 10000 })), derived(TODAY, { total_value: 1010 })]
      const r = evaluateGate({ ...base, derived: derivedRows, knownAt: known({ cash_value: 9299, total_value: 9999 }) })
      expect(r.pass).toBe(false)
      expect(r.checks.G1.pass).toBe(false)
      expect(r.checks.G2.pass).toBe(false)
    })

    it('a misprice concept no longer exists: it only ever dirtied cost and P&L, never value', () => {
      expect('MISPRICED_TICKERS' in deriveHistoryModule).toBe(false)
    })
  })

  describe('corrupt snapshots', () => {
    const corrupt = snap('2026-03-11', { stocks_value: 0, ons_value: 0, cash_value: 0 })
    const withCorrupt = (base: GateInput, ...extra: PortfolioSnapshot[]) =>
      ({ ...base, snapshots: base.snapshots.map(s => extra.find(e => e.snapshot_date === s.snapshot_date) ?? s) })

    it('classifies a snapshot whose components do not sum to its total as corrupt', () => {
      expect(isCorruptSnapshot(corrupt)).toBe(true)
      expect(isCorruptSnapshot(snap('2026-03-11'))).toBe(false)
    })

    it('explains the zeroed components but never the total, and reports the date', () => {
      const r = evaluateGate(withCorrupt(input(), corrupt))
      expect(r.checks.G1.pass).toBe(true)
      expect(r.checks.G2.pass).toBe(true)
      expect(r.corruptDates).toEqual(['2026-03-11'])
      expect(r.diffs.find(d => d.date === '2026-03-11')?.reasons).toMatchObject({ stocksCash: 'corrupt-snapshot', total: null, ons: 'corrupt-snapshot' })

      const base = input()
      const wrongTotal = evaluateGate({ ...withCorrupt(base, corrupt), derived: replace(base.derived, '2026-03-11', { total_value: 1300 }) })
      expect(wrongTotal.checks.G2.pass).toBe(false)
    })

    it('fails when more than one snapshot is corrupt', () => {
      const r = evaluateGate(withCorrupt(input(), corrupt, snap('2026-03-12', { stocks_value: 0, ons_value: 0, cash_value: 0 })))
      expect(r.corruptDates).toEqual(['2026-03-11', '2026-03-12'])
      expect(r.checks.G1.pass).toBe(false)
    })

    it('does not count a corrupt date as a compared ON date', () => {
      const base = input({ onPriceDates: dates.slice(0, 5) })
      const r = evaluateGate(withCorrupt(base, snap('2026-03-09', { stocks_value: 0, ons_value: 0, cash_value: 0 })))
      expect(r.checks.G4.pass).toBe(false)
    })
  })

  it('G2 only looks at live snapshots: an estimated one with a big total diff does not fail it', () => {
    const base = input()
    const snapshots = base.snapshots.map(s => (s.snapshot_date === '2026-03-12' ? { ...s, source: 'estimated' as const } : s))
    const r = evaluateGate({ ...base, snapshots, derived: replace(base.derived, '2026-03-12', { total_value: 1500, ons_value: 600 }) })
    expect(r.checks.G2.pass).toBe(true)
    const live = evaluateGate({ ...base, derived: replace(base.derived, '2026-03-12', { total_value: 1500, ons_value: 600 }) })
    expect(live.checks.G2.pass).toBe(false)
  })

  it('G3 compares the derived today row with the live valuation at $1', () => {
    expect(evaluateGate(input({ liveTotal: 1010.9 })).checks.G3.pass).toBe(true)
    expect(evaluateGate(input({ liveTotal: 1012 })).checks.G3.pass).toBe(false)
    expect(evaluateGate(input({ liveTotal: null })).checks.G3.pass).toBe(false)
    const noToday = input()
    expect(evaluateGate({ ...noToday, derived: noToday.derived.filter(r => r.snapshot_date !== TODAY) }).checks.G3.pass).toBe(false)
  })

  describe('G4', () => {
    it('counts only live dates present in on_price_history, and needs 5 of them', () => {
      const r = evaluateGate(input({ onPriceDates: ['2026-03-13', '2026-03-16', '2026-03-17'] }))
      expect(r.checks.G4.pass).toBe(false)
      expect(r.checks.G4.detail).toContain('3')
      expect(evaluateGate(input({ onPriceDates: [] })).checks.G4.pass).toBe(false)
      expect(evaluateGate(input({ onPriceDates: dates.slice(0, 5) })).checks.G4.pass).toBe(true)
    })

    it('a snapshot weekday with no captured ON prices (holiday) does not count', () => {
      expect(evaluateGate(input({ onPriceDates: dates.slice(0, 4) })).checks.G4.pass).toBe(false)
    })

    it('excludes dates valued by an ON aggregate mark (circular)', () => {
      const r = evaluateGate(input({ onMarkDates: ['2026-03-09', '2026-03-10', '2026-03-11'] }))
      expect(r.checks.G4.pass).toBe(false)
      expect(r.checks.G4.detail).toContain('4')
    })

    it('fails when a qualifying ON date differs by more than $1 and is unexplained', () => {
      const base = input()
      const r = evaluateGate({ ...base, derived: replace(base.derived, '2026-03-16', { ons_value: 104, total_value: 1004 }) })
      expect(r.checks.G4.pass).toBe(false)
      expect(r.checks.G2.pass).toBe(false)
    })
  })

  it('W3: a snapshot date missing from derived fails the gate', () => {
    const base = input()
    const r = evaluateGate({ ...base, derived: base.derived.filter(d => d.snapshot_date !== '2026-03-13') })
    expect(r.missingInDerived).toEqual(['2026-03-13'])
    expect(r.checks.G1.pass).toBe(false)
  })

  it('snapshots before the derived history starts are not "missing"', () => {
    const base = input()
    const r = evaluateGate({ ...base, snapshots: [snap('2026-02-02'), ...base.snapshots] })
    expect(r.missingInDerived).toEqual([])
    expect(r.checks.G1.pass).toBe(true)
  })

  it('skips snapshots with no breakdown', () => {
    const base = input()
    const r = evaluateGate({ ...base, snapshots: base.snapshots.map(s => (s.snapshot_date === '2026-03-12' ? { ...s, stocks_value: undefined } : s)) })
    expect(r.skippedNoBreakdown).toEqual(['2026-03-12'])
    expect(r.checks.G1.pass).toBe(true)
  })

  it('W3: each check reports its compared count, and G1/G2 fail when they compared nothing', () => {
    const ok = evaluateGate(input())
    expect(ok.checks.G1.detail).toContain('7 dates compared')
    expect(ok.checks.G2.detail).toContain('7 live dates compared')
    const none = evaluateGate(input({ snapshots: [] }))
    expect(none.checks.G1.pass).toBe(false)
    expect(none.checks.G2.pass).toBe(false)
    expect(none.checks.G1.detail).toContain('0 dates compared')
  })
})
