import { describe, it, expect } from 'vitest'
import { evaluateGate, isCorruptSnapshot, type GateInput } from '../derive-gate'
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
    transactions: [], movements: [], splits: [],
    liveTotal: 1010,
    onFirstPriceDate: '2026-03-09',
    ...over,
  }
}
const replace = (rows: DerivedRow[], date: string, over: Partial<DerivedRow>) =>
  rows.map(r => (r.snapshot_date === date ? { ...r, ...over } : r))

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
    expect(bad.diffs.find(d => d.date === '2026-03-10')).toMatchObject({ dStocksCash: 3, reason: null })

    const edge = evaluateGate({ ...base, derived: replace(base.derived, '2026-03-10', { stocks_value: 601 }) })
    expect(edge.checks.G1.pass).toBe(true)
  })

  it('G1 accepts a diff that explainDiff explains (late-loaded)', () => {
    const base = input()
    const late = { ticker: 'ZZZ', operation: 'COMPRA', quantity: 1, price: 1, commission: 0, date: '2026-03-10', asset_type: 'ACCION', created_at: '2026-03-18T12:00:00Z' }
    const r = evaluateGate({
      ...base, transactions: [late],
      derived: replace(base.derived, '2026-03-10', { stocks_value: 650 }),
    })
    expect(r.checks.G1.pass).toBe(true)
    expect(r.diffs.find(d => d.date === '2026-03-10')?.reason).toBe('late-loaded')
  })

  it('classifies a snapshot whose components do not sum to its total as corrupt, not as a failure', () => {
    const corrupt = snap('2026-03-11', { stocks_value: 0, ons_value: 0, cash_value: 0 })
    expect(isCorruptSnapshot(corrupt)).toBe(true)
    expect(isCorruptSnapshot(snap('2026-03-11'))).toBe(false)
    const base = input()
    const r = evaluateGate({ ...base, snapshots: base.snapshots.map(s => (s.snapshot_date === '2026-03-11' ? corrupt : s)) })
    expect(r.checks.G1.pass).toBe(true)
    expect(r.checks.G2.pass).toBe(true)
    expect(r.diffs.find(d => d.date === '2026-03-11')?.reason).toBe('corrupt-snapshot')
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

  it('G4 counts only live dates from the first recorded ON price on, and needs 5 of them', () => {
    // only 3 dates on/after the first price date -> not enough, aggregate-mark-only dates do not count
    const r = evaluateGate(input({ onFirstPriceDate: '2026-03-13' }))
    expect(r.checks.G4.pass).toBe(false)
    expect(r.checks.G4.detail).toContain('3')
    expect(evaluateGate(input({ onFirstPriceDate: null })).checks.G4.pass).toBe(false)
    expect(evaluateGate(input({ onFirstPriceDate: '2026-03-11' })).checks.G4.pass).toBe(true)
  })

  it('G4 fails when a qualifying ON date differs by more than $1 and is unexplained', () => {
    const base = input()
    const r = evaluateGate({ ...base, derived: replace(base.derived, '2026-03-16', { ons_value: 104, total_value: 1004 }) })
    expect(r.checks.G4.pass).toBe(false)
    expect(r.checks.G2.pass).toBe(false)
  })

  it('reports snapshot dates missing from derived without failing, and skips snapshots with no breakdown', () => {
    const base = input()
    const r = evaluateGate({
      ...base,
      derived: base.derived.filter(d => d.snapshot_date !== '2026-03-13'),
      snapshots: base.snapshots.map(s => (s.snapshot_date === '2026-03-12' ? { ...s, stocks_value: undefined } : s)),
    })
    expect(r.missingInDerived).toEqual(['2026-03-13'])
    expect(r.skippedNoBreakdown).toEqual(['2026-03-12'])
    expect(r.checks.G1.pass).toBe(true)
  })
})
