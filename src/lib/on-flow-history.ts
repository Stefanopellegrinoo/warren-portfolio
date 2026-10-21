// ON flow history read helpers (pure, plus one thin loader). BYMA lists FUTURE flows only and the nightly
// replace drops what has passed, so past flows come from three places, in this priority:
//   past (< today):  on_flow_history (provenance 'byma-history') > on_cashflows > derived
//   future (>= today): on_cashflows ('byma') > on_flow_history ('byma-history', e.g. dropped on its own date)
// 'derived' = reconstructed from on_terms.accrual_start for plain fixed-rate bonds (see deriveBackwardFlows).
import type { SupabaseClient } from '@supabase/supabase-js'
import { NON_PERIODIC_FC, PERIOD_MONTHS, addMonths } from './byma-educa'
import { dcf, type DayCount } from './bond-math'

export type FlowProvenance = 'byma-history' | 'byma' | 'derived'

export interface FlowRow {
  date: string // unadjusted
  ren: number
  amo: number
}

export interface HistoryFlow extends FlowRow {
  provenance: FlowProvenance
}

export interface DerivationInput {
  est: string | null // BYMA `est`: 'Tasa Fija' | 'Step Up' | 'Cupon Cero' | 'Tasa Variable'
  frequency: string | null // BYMA `fc`
  couponRate: number | null // fraction (0.0725 = 7.25%)
  issueDate: string
  accrualStart: string // last unadjusted coupon date before settle (or the issue date)
  residualPct: number
  dayCount: DayCount // resolved (override > law default)
  currentFlows: FlowRow[] // on_cashflows, used only to detect amortizing schedules
  // The real first coupon date when it is known (prospectus). Without it a long first coupon
  // (CS50: issue 2025-12-10, first coupon 2026-09-10) cannot be told apart from a short one.
  firstCouponDate?: string
}

export type DerivationResult =
  | { ok: true; flows: HistoryFlow[]; warnings: 'first-period-assumed'[] }
  | { ok: false; reason: DerivationRefusal }

export type DerivationRefusal =
  | 'step-up'
  | 'floating'
  | 'unsupported-rate-type'
  | 'amortized'
  | 'unknown-frequency'
  | 'no-coupon-rate'
  | 'first-coupon-off-schedule'

const round6 = (x: number) => Math.round(x * 1e6) / 1e6
const NO_PAST: DerivationResult = { ok: true, flows: [], warnings: [] }

function refusal(i: DerivationInput): DerivationRefusal | null {
  if (i.est === 'Step Up') return 'step-up'
  if (i.est === 'Tasa Variable') return 'floating'
  if (i.est !== 'Tasa Fija' && i.est !== 'Cupon Cero') return 'unsupported-rate-type'
  // Past residual and past amortizations are unknowable once anything has amortized.
  if (i.residualPct < 100 || i.currentFlows.filter((f) => f.amo > 0).length > 1) return 'amortized'
  return null
}

/**
 * Past coupons of a fixed-rate, non-amortized bond: step back from accrual_start by the coupon period
 * down to (excluding) the issue date. Each coupon = cup x day count over its own period on residual 100,
 * the first period starting at the issue date. Dates are anchored on accrual_start (no month-end drift).
 * Refuses (with a reason) for anything whose past cannot be known.
 */
export function deriveBackwardFlows(i: DerivationInput): DerivationResult {
  const no = refusal(i)
  if (no) return { ok: false, reason: no }
  if (i.est === 'Cupon Cero' || (i.frequency !== null && NON_PERIODIC_FC.includes(i.frequency))) return NO_PAST
  const months = i.frequency ? PERIOD_MONTHS[i.frequency] : undefined
  if (!months) return { ok: false, reason: 'unknown-frequency' }
  if (i.couponRate === null || !(i.couponRate > 0)) return { ok: false, reason: 'no-coupon-rate' }
  if (i.accrualStart <= i.issueDate) return NO_PAST

  const dates: string[] = []
  for (let k = 0; ; k++) {
    const d = addMonths(i.accrualStart, -k * months)
    if (d <= i.issueDate) break
    dates.unshift(d)
  }
  const first = i.firstCouponDate
  const kept = first === undefined ? dates : dates.filter((d) => d >= first)
  if (first !== undefined && kept[0] !== first) return { ok: false, reason: 'first-coupon-off-schedule' }

  const flows = kept.map((date, idx): HistoryFlow => {
    const prev = idx === 0 ? i.issueDate : kept[idx - 1]
    return { date, ren: round6(i.couponRate! * 100 * dcf(i.dayCount, prev, date)), amo: 0, provenance: 'derived' }
  })
  const regularStart = kept.length > 0 && kept[0] === addMonths(i.issueDate, months)
  return { ok: true, flows, warnings: first === undefined && kept.length > 0 && !regularStart ? ['first-period-assumed'] : [] }
}

export interface MergeInput {
  today: string
  history: FlowRow[]
  current: FlowRow[]
  derived: HistoryFlow[]
}

export function mergeFlowHistory({ today, history, current, derived }: MergeInput): HistoryFlow[] {
  const byDate = new Map<string, HistoryFlow>()
  const put = (rows: FlowRow[], provenance: FlowProvenance) => {
    for (const r of rows) if (!byDate.has(r.date)) byDate.set(r.date, { date: r.date, ren: r.ren, amo: r.amo, provenance })
  }
  // First writer wins, so insert in priority order: past and future differ only in who goes first.
  put(history.filter((f) => f.date < today), 'byma-history')
  put(current, 'byma')
  put(history, 'byma-history')
  put(derived.filter((f) => f.date < today), 'derived')
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

type Row = Record<string, unknown>
const toRows = (data: Row[] | null): FlowRow[] =>
  (data ?? []).map((r) => ({ date: r.flow_date as string, ren: Number(r.ren), amo: Number(r.amo) }))

/** Both public tables for one ISIN. Throws on any read error: a partial schedule is worse than none. */
export async function loadFlowRows(sb: SupabaseClient, isin: string): Promise<{ history: FlowRow[]; current: FlowRow[] }> {
  const read = async (table: string) => {
    const { data, error } = await sb.from(table).select('flow_date, ren, amo').eq('isin', isin).order('flow_date')
    if (error) throw new Error(`${table}: ${error.message}`)
    return toRows(data as Row[] | null)
  }
  const [history, current] = await Promise.all([read('on_flow_history'), read('on_cashflows')])
  return { history, current }
}
