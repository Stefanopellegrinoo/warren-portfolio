// src/lib/derive-gate.ts
/**
 * Cutover gate (REQ-15) as pure assertions: derived rows vs measured snapshots.
 * No DB, no network — the compare script feeds it.
 */
import type { PortfolioSnapshot } from '@/types'
import { explainDiff, type DerivedRow, type DiffReason, type SplitEvent } from './derive-history'
import type { ReplayMovement, ReplayTransaction } from './portfolio-replay'

export type Reason = DiffReason | 'corrupt-snapshot'

export interface DiffLine {
  date: string
  source: 'live' | 'estimated'
  dStocksCash: number
  dTotal: number
  dOns: number
  reason: Reason | null
}

export interface GateCheck { pass: boolean; detail: string }

export interface GateInput {
  today: string
  derived: DerivedRow[]
  snapshots: PortfolioSnapshot[]
  transactions: ReplayTransaction[]
  movements: ReplayMovement[]
  splits: SplitEvent[]
  /** Stored positions at the same quotes (computeLiveSnapshotRow). null = nothing to value. */
  liveTotal: number | null
  /** min(on_price_history.price_date) — ON dates before it can only be aggregate-mark (circular). */
  onFirstPriceDate: string | null
}

export interface GateResult {
  pass: boolean
  checks: { G1: GateCheck; G2: GateCheck; G3: GateCheck; G4: GateCheck }
  diffs: DiffLine[]
  missingInDerived: string[]
  skippedNoBreakdown: string[]
}

export const MIN_ON_DATES = 5
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

export function evaluateGate(input: GateInput): GateResult {
  const { today, transactions, movements, splits } = input
  const derivedByDate = new Map(input.derived.map(r => [r.snapshot_date, r]))
  const diffs: DiffLine[] = []
  const missingInDerived: string[] = []
  const skippedNoBreakdown: string[] = []
  const corruptDates = new Set<string>()

  for (const s of input.snapshots) {
    const date = String(s.snapshot_date).slice(0, 10)
    if (date >= today) continue // today is G3's job: its snapshot is a partial day
    const d = derivedByDate.get(date)
    if (!d) { missingInDerived.push(date); continue }
    if (!hasBreakdown(s)) { skippedNoBreakdown.push(date); continue }
    const corrupt = isCorruptSnapshot(s)
    if (corrupt) corruptDates.add(date)
    const dStocksCash = d.stocks_value + d.cash_value - (n(s.stocks_value) + n(s.cash_value))
    const dTotal = d.total_value - n(s.total_value)
    const dOns = d.ons_value - n(s.ons_value)
    const differs = bad(dStocksCash) || bad(dTotal) || bad(dOns)
    diffs.push({
      date, source: s.source ?? 'live', dStocksCash, dTotal, dOns,
      reason: !differs ? null : corrupt ? 'corrupt-snapshot' : explainDiff(date, transactions, movements, splits),
    })
  }

  const unexplained = (pick: (l: DiffLine) => number, among: DiffLine[]) =>
    among.filter(l => bad(pick(l)) && l.reason === null)

  const g1Bad = unexplained(l => l.dStocksCash, diffs)
  const live = diffs.filter(l => l.source === 'live')
  const g2Bad = unexplained(l => l.dTotal, live)

  const todayRow = derivedByDate.get(today)
  const g3: GateCheck = !todayRow || input.liveTotal == null
    ? { pass: false, detail: 'no derived today row or no live valuation to compare with' }
    : { pass: !bad(todayRow.total_value - input.liveTotal), detail: `derived ${todayRow.total_value.toFixed(2)} vs live ${input.liveTotal.toFixed(2)}` }

  // Before the first recorded ON price a derived ON value can only come from the aggregate marks
  // of these very snapshots: agreement there is circular, so those dates do not count.
  const onDates = input.onFirstPriceDate ? live.filter(l => l.date >= input.onFirstPriceDate!) : []
  const g4Bad = unexplained(l => l.dOns, onDates)
  const g4: GateCheck = onDates.length < MIN_ON_DATES
    ? { pass: false, detail: `${onDates.length} live ON dates from ${input.onFirstPriceDate ?? 'n/a'}, need ${MIN_ON_DATES}` }
    : { pass: g4Bad.length === 0, detail: g4Bad.length ? `unexplained ON diffs: ${listed(g4Bad)}` : `${onDates.length} live ON dates agree` }

  const checks = {
    G1: { pass: g1Bad.length === 0, detail: g1Bad.length ? `unexplained stocks+cash diffs: ${listed(g1Bad)}` : `${diffs.length} dates compared` },
    G2: { pass: g2Bad.length === 0, detail: g2Bad.length ? `unexplained live total diffs: ${listed(g2Bad)}` : `${live.length} live dates compared` },
    G3: g3,
    G4: g4,
  }
  return {
    pass: Object.values(checks).every(c => c.pass),
    checks, diffs, missingInDerived, skippedNoBreakdown,
  }
}
