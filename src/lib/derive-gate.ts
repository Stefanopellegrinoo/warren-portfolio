// src/lib/derive-gate.ts
/**
 * Cutover gate (REQ-15) as pure assertions: derived rows vs measured snapshots.
 * No DB, no network — the compare script feeds it.
 */
import type { PortfolioSnapshot } from '@/types'
import type { DerivedRow, LedgerReason, KnownAt } from './derive-history'

export type Reason = LedgerReason | 'corrupt-snapshot'
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
  /** Distinct on_price_history.price_date: the sessions whose ON closes were actually captured. */
  onPriceDates: string[]
  /** Dates whose derived ONs came from an aggregate mark of these very snapshots (circular). */
  onMarkDates: string[]
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
  corruptDates: string[]
}

export const MIN_ON_DATES = 5
export const MAX_CORRUPT_DATES = 1
export const GATE_TOLERANCE = 1

const hasBreakdown = (s: PortfolioSnapshot) =>
  s.stocks_value != null && s.ons_value != null && s.cash_value != null

/** A measured row whose components do not add up to its own total (e.g. zeroed breakdown with a total set). */
export function isCorruptSnapshot(s: PortfolioSnapshot): boolean {
  if (!hasBreakdown(s)) return false
  return Math.abs(Number(s.stocks_value) + Number(s.ons_value) + Number(s.cash_value) - Number(s.total_value)) > GATE_TOLERANCE
}

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
  const corruptDates: string[] = []
  const corruptCount = input.snapshots.filter(s => String(s.snapshot_date).slice(0, 10) < today && isCorruptSnapshot(s)).length

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
    const corrupt = isCorruptSnapshot(s)
    if (corrupt) corruptDates.push(date)

    const delta = (c: Component) => valueOf[c](d) - valueOf[c](s)
    // Re-deriving is O(history): only when a component is actually off, and at most once per date.
    let known: KnownAt | null | undefined
    const knownOnce = () => (known === undefined ? (known = input.knownAt?.(date) ?? null) : known)
    // A corrupt row has zeroed components but a set total. Its components are excused only if the
    // derived total still lands on that total (|dTotal| <= $1). If it does not, the total diff is
    // reported as 'corrupt-snapshot' (visible, never silent) for the single allowed corrupt date, and
    // the components stay unexplained so the gate fails.
    const totalAgrees = !bad(delta('total'))
    // An explanation excuses a component only if it reproduces THAT component of the snapshot.
    const reasonFor = (c: Component): DiffLine['reasons'][Component] => {
      if (!bad(delta(c))) return null
      if (corrupt && c !== 'total' && totalAgrees) return 'corrupt-snapshot'
      if (corrupt && c === 'total' && corruptCount <= MAX_CORRUPT_DATES) return 'corrupt-snapshot'
      const k = knownOnce()
      if (k && !bad(valueOf[c](k.row) - valueOf[c](s))) return k.reason
      return 'unexplained'
    }
    diffs.push({
      date, source: s.source ?? 'live',
      dStocksCash: delta('stocksCash'), dTotal: delta('total'), dOns: delta('ons'),
      reasons: { stocksCash: reasonFor('stocksCash'), total: reasonFor('total'), ons: reasonFor('ons') },
    })
  }

  const unexplained = (c: Component, among: DiffLine[]) => among.filter(l => l.reasons[c] === 'unexplained')

  const live = diffs.filter(l => l.source === 'live')
  const g1Bad = unexplained('stocksCash', diffs)
  const g2Bad = unexplained('total', live)
  const excusedTotals = live.filter(l => l.reasons.total === 'corrupt-snapshot')

  const g1Problems = [
    g1Bad.length ? `unexplained stocks+cash diffs: ${listed(g1Bad)}` : '',
    missingInDerived.length ? `snapshot dates missing from derived: ${missingInDerived.join(', ')}` : '',
    corruptDates.length > MAX_CORRUPT_DATES ? `${corruptDates.length} corrupt snapshots (max ${MAX_CORRUPT_DATES}): ${corruptDates.join(', ')}` : '',
    diffs.length === 0 ? 'nothing compared' : '',
  ].filter(Boolean)

  const todayRow = derivedByDate.get(today)
  const g3: GateCheck = !todayRow || input.liveTotal == null
    ? { pass: false, detail: 'no derived today row or no live valuation to compare with' }
    : { pass: !bad(todayRow.total_value - input.liveTotal), detail: `derived ${todayRow.total_value.toFixed(2)} vs live ${input.liveTotal.toFixed(2)}` }

  // Only sessions with captured ON closes count, and never ones valued by the snapshots' own marks
  // (circular) or whose breakdown is corrupt.
  const priced = new Set(input.onPriceDates)
  const marked = new Set(input.onMarkDates)
  const corrupt = new Set(corruptDates)
  const onDates = live.filter(l => priced.has(l.date) && !marked.has(l.date) && !corrupt.has(l.date))
  const g4Bad = unexplained('ons', onDates)
  const g4: GateCheck = onDates.length < MIN_ON_DATES
    ? { pass: false, detail: `${onDates.length} live ON dates compared, need ${MIN_ON_DATES}` }
    : { pass: g4Bad.length === 0, detail: g4Bad.length ? `unexplained ON diffs: ${listed(g4Bad)}` : `${onDates.length} live ON dates compared, all agree` }

  const checks = {
    G1: { pass: g1Problems.length === 0, detail: `${diffs.length} dates compared${g1Problems.length ? `; ${g1Problems.join('; ')}` : ''}` },
    G2: {
      pass: g2Bad.length === 0 && live.length > 0,
      detail: `${live.length} live dates compared${excusedTotals.length ? `; corrupt-snapshot totals off by more than $${GATE_TOLERANCE}: ${listed(excusedTotals)}` : ''}${g2Bad.length ? `; unexplained live total diffs: ${listed(g2Bad)}` : live.length ? '' : '; nothing compared'}`,
    },
    G3: g3,
    G4: g4,
  }
  return {
    pass: Object.values(checks).every(c => c.pass),
    checks, diffs, missingInDerived, skippedNoBreakdown, corruptDates,
  }
}
