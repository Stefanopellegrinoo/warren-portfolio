// src/lib/derive-gate.ts
/**
 * Cutover gate (REQ-15) as pure assertions: derived rows vs measured snapshots.
 * No DB, no network — the compare script feeds it.
 */
import type { PortfolioSnapshot } from '@/types'
import type { DerivedRow, LedgerReason, KnownAt } from './derive-history'

export type Reason = LedgerReason
export type Component = 'stocksCash' | 'total' | 'ons'

export interface DiffLine {
  date: string
  source: 'live' | 'estimated'
  dStocksCash: number
  dTotal: number
  dOns: number
  /** Per component: null = within tolerance, 'unexplained' = the gate counts it as a failure. */
  reasons: Record<Component, Reason | 'unexplained' | null>
}

export interface GateCheck { pass: boolean; detail: string }

export type { KnownAt }

export interface GateInput {
  today: string
  derived: DerivedRow[]
  snapshots: PortfolioSnapshot[]
  /** Stored positions at the same quotes (computeLiveSnapshotRow). null = nothing to value. */
  liveTotal: number | null
  /** Dates whose derived ONs all came from recorded on_price_history closes (flags.onRecordedDates): the only independent ON values. */
  onRecordedDates: string[]
  /** Subset of onRecordedDates with a close dated exactly that day; only these count toward MIN_ON_DATES. */
  onExactCloseDates: string[]
  /**
   * Re-derives D over the ledger as D's snapshot saw it (knownLedgerAt). null = nothing was late,
   * so there is nothing to explain with. Without it, no ledger explanation is ever accepted.
   */
  knownAt?: (date: string) => KnownAt | null
}

export interface GateResult {
  pass: boolean
  checks: { G1: GateCheck; G2: GateCheck; G3: GateCheck; G4: GateCheck }
  diffs: DiffLine[]
  missingInDerived: string[]
  skippedNoBreakdown: string[]
}

export const MIN_ON_DATES = 5
/** More null-breakdown snapshots than this fails G1: one is the known 07-23 hole, more needs a look. */
export const MAX_SKIPPED_NO_BREAKDOWN = 1
export const GATE_TOLERANCE = 1

const hasBreakdown = (s: PortfolioSnapshot) =>
  s.stocks_value != null && s.ons_value != null && s.cash_value != null

const n = (v: unknown) => Number(v ?? 0)
const bad = (d: number) => Math.abs(d) > GATE_TOLERANCE
const listed = (lines: DiffLine[]) => lines.map(l => l.date).join(', ')

type Valued = { stocks_value?: unknown; cash_value?: unknown; total_value?: unknown; ons_value?: unknown }
const stocksCashOf = (r: Valued) => n(r.stocks_value) + n(r.cash_value)
const valueOf: Record<Component, (r: Valued) => number> = {
  stocksCash: stocksCashOf,
  total: r => n(r.total_value),
  ons: r => n(r.ons_value),
}

export function evaluateGate(input: GateInput): GateResult {
  const { today } = input
  const derivedByDate = new Map(input.derived.map(r => [r.snapshot_date, r]))
  const firstDerived = input.derived.map(r => r.snapshot_date).sort()[0]
  const diffs: DiffLine[] = []
  const missingInDerived: string[] = []
  const skippedNoBreakdown: string[] = []

  for (const s of input.snapshots) {
    const date = String(s.snapshot_date).slice(0, 10)
    if (date >= today) continue // today is G3's job: its snapshot is a partial day
    const d = derivedByDate.get(date)
    if (!d) {
      // before the ledger starts there is nothing to derive, which is not a hole
      if (firstDerived && date >= firstDerived) missingInDerived.push(date)
      continue
    }
    if (!hasBreakdown(s)) { skippedNoBreakdown.push(date); continue }

    const delta = (c: Component) => valueOf[c](d) - valueOf[c](s)
    // Re-deriving is O(history): only when a component is actually off, and at most once per date.
    let known: KnownAt | null | undefined
    const knownOnce = () => (known === undefined ? (known = input.knownAt?.(date) ?? null) : known)
    // An explanation excuses a component only if it reproduces THAT component of the snapshot.
    // ONs are never explained by the ledger (knownAt has no marks): G4 covers them from recorded closes.
    const reasonFor = (c: 'stocksCash' | 'ons'): DiffLine['reasons'][Component] => {
      if (!bad(delta(c))) return null
      const k = c === 'stocksCash' ? knownOnce() : null
      if (k && !bad(valueOf[c](k.row) - valueOf[c](s))) return k.reason
      return 'unexplained'
    }
    const stocksCash = reasonFor('stocksCash')
    const ons = reasonFor('ons')
    // The total is never explained on its own: it must equal the sum of its components, and it is
    // explained iff every component that is off is (it inherits that reason).
    const total: DiffLine['reasons'][Component] = !bad(delta('total')) ? null
      : bad(delta('total') - delta('stocksCash') - delta('ons')) || stocksCash === 'unexplained' || ons === 'unexplained' ? 'unexplained'
      : stocksCash ?? ons
    diffs.push({
      date, source: s.source ?? 'live',
      dStocksCash: delta('stocksCash'), dTotal: delta('total'), dOns: delta('ons'),
      reasons: { stocksCash, total, ons },
    })
  }

  const unexplained = (c: Component, among: DiffLine[]) => among.filter(l => l.reasons[c] === 'unexplained')

  const live = diffs.filter(l => l.source === 'live')
  const g1Bad = unexplained('stocksCash', diffs)
  const g2Bad = unexplained('total', live)

  const g1Problems = [
    g1Bad.length ? `unexplained stocks+cash diffs: ${listed(g1Bad)}` : '',
    missingInDerived.length ? `snapshot dates missing from derived: ${missingInDerived.join(', ')}` : '',
    skippedNoBreakdown.length > MAX_SKIPPED_NO_BREAKDOWN ? `${skippedNoBreakdown.length} snapshots without breakdown (max ${MAX_SKIPPED_NO_BREAKDOWN}): ${skippedNoBreakdown.join(', ')}` : '',
    diffs.length === 0 ? 'nothing compared' : '',
  ].filter(Boolean)

  const todayRow = derivedByDate.get(today)
  const g3: GateCheck = !todayRow || input.liveTotal == null
    ? { pass: false, detail: 'no derived today row or no live valuation to compare with' }
    : { pass: !bad(todayRow.total_value - input.liveTotal), detail: `derived ${todayRow.total_value.toFixed(2)} vs live ${input.liveTotal.toFixed(2)}` }

  // Only dates whose derived ONs came from recorded closes count: marks and cost are circular or trivial.
  const recorded = new Set(input.onRecordedDates)
  const onDates = live.filter(l => recorded.has(l.date))
  const exact = new Set(input.onExactCloseDates)
  const exactCount = onDates.filter(l => exact.has(l.date)).length
  const g4Bad = unexplained('ons', onDates)
  const g4: GateCheck = exactCount < MIN_ON_DATES
    ? { pass: false, detail: `${onDates.length} live ON dates compared, ${exactCount} with an exact close, need ${MIN_ON_DATES}` }
    : { pass: g4Bad.length === 0, detail: g4Bad.length ? `unexplained ON diffs: ${listed(g4Bad)}` : `${onDates.length} live ON dates compared (${exactCount} with an exact close), all agree` }

  const checks = {
    G1: { pass: g1Problems.length === 0, detail: `${diffs.length} dates compared${g1Problems.length ? `; ${g1Problems.join('; ')}` : ''}` },
    G2: {
      pass: g2Bad.length === 0 && live.length > 0,
      detail: `${live.length} live dates compared${g2Bad.length ? `; unexplained live total diffs: ${listed(g2Bad)}` : live.length ? '' : '; nothing compared'}`,
    },
    G3: g3,
    G4: g4,
  }
  return {
    pass: Object.values(checks).every(c => c.pass),
    checks, diffs, missingInDerived, skippedNoBreakdown,
  }
}
