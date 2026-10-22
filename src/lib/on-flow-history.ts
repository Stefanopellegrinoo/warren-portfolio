// ON flow history read helpers (pure, plus one thin loader). BYMA lists FUTURE flows only and the nightly
// replace drops what has passed, so past flows come from three places, in this priority:
//   past (< today):  on_flow_history BYMA rows ('byma-history') > on_cashflows > bonistas reports > derived
//   future (>= today): on_cashflows ('byma') > on_flow_history ('byma-history', e.g. dropped on its own date)
// 'derived' = reconstructed from on_terms.accrual_start for plain fixed-rate bonds (see deriveBackwardFlows).
import type { SupabaseClient } from '@supabase/supabase-js'
import { NON_PERIODIC_FC, PERIOD_MONTHS, addMonths } from './byma-educa'
import { dcf, type DayCount } from './bond-math'
import { addBusinessDays } from './ar-calendar'

export type FlowProvenance = 'byma-history' | 'byma-history-unconfirmed' | 'byma' | 'bonistas' | 'derived'

export interface FlowRow {
  date: string // unadjusted
  ren: number
  amo: number
}

export interface HistoryFlow extends FlowRow {
  provenance: FlowProvenance
  reason?: string // set when provenance is 'byma-history-unconfirmed'
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

export interface HistoryRow extends FlowRow {
  firstSeenAsOf: string
  lastSeenAsOf: string
  /** 'bonistas' = a past payment reported by bonistas.com; anything else is a BYMA listing. */
  source?: string
}

/** A payment reported on another date within this window is the same payment (schedule vs paid date). */
export const SAME_PAYMENT_DAYS = 7
const DAY_MS = 86_400_000
const daysApart = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS

export interface MergeInput {
  today: string
  history: HistoryRow[]
  current: FlowRow[]
  inCatalog: boolean // the ISIN is in today's on_terms: then on_cashflows is the whole truth about the future
  derived: HistoryFlow[]
}

export const CONFIRM_WINDOW_BUSINESS_DAYS = 5

// A past row is confirmed (BYMA still listed it right up to its date) when it was last seen within the
// window before flow_date. Otherwise BYMA may have removed it (early redemption, canje, schedule fix)
// while it was still future: downstream proposals must ask the user to confirm it explicitly.
const isConfirmed = (r: HistoryRow) => addBusinessDays(r.lastSeenAsOf, CONFIRM_WINDOW_BUSINESS_DAYS) >= r.date

export function mergeFlowHistory({ today, history, current, inCatalog, derived }: MergeInput): HistoryFlow[] {
  const out: HistoryFlow[] = []
  const taken = new Set<string>()
  const add = (f: HistoryFlow) => {
    if (taken.has(f.date)) return
    taken.add(f.date)
    out.push(f)
  }
  // A second-hand source on a nearby date is the same payment, not another one.
  const addIfNew = (f: HistoryFlow) => {
    if (!out.some((o) => daysApart(o.date, f.date) <= SAME_PAYMENT_DAYS)) add(f)
  }
  const byma = history.filter((x) => x.source !== 'bonistas')
  // First writer wins, so insert in priority order: past = BYMA history > on_cashflows > bonistas > derived;
  // future = on_cashflows only (history adds future rows only for an ISIN no longer in the catalog).
  for (const r of byma.filter((x) => x.date < today)) {
    const { date, ren, amo } = r
    add(isConfirmed(r)
      ? { date, ren, amo, provenance: 'byma-history' }
      : { date, ren, amo, provenance: 'byma-history-unconfirmed', reason: `last-seen-${r.lastSeenAsOf}-more-than-${CONFIRM_WINDOW_BUSINESS_DAYS}-business-days-before` })
  }
  for (const r of current) add({ date: r.date, ren: r.ren, amo: r.amo, provenance: 'byma' })
  if (!inCatalog) {
    for (const r of byma.filter((x) => x.date >= today)) add({ date: r.date, ren: r.ren, amo: r.amo, provenance: 'byma-history-unconfirmed', reason: 'isin-not-in-catalog' })
  }
  for (const r of history.filter((x) => x.source === 'bonistas' && x.date < today)) addIfNew({ date: r.date, ren: r.ren, amo: r.amo, provenance: 'bonistas' })
  for (const f of derived.filter((x) => x.date < today)) addIfNew(f)
  return out.sort((x, y) => x.date.localeCompare(y.date))
}

export interface GapTerms {
  frequency: string | null
  est: string | null
  issueDate: string
  accrualStart: string
  residualPct: number
}

export interface ScheduleGaps {
  /** Expected payment dates in [from, to) that no source covers: the user is asked for them. */
  missingDates: string[]
  /** % of original VN amortized (100 − residual) that the known flows do not explain. */
  unexplainedAmortization: number
}

/**
 * What the app knows is missing: the bond's own calendar (period stepped from accrual_start)
 * gives the dates a payment had to exist, and its residual says how much has amortized.
 */
export function scheduleGaps(terms: GapTerms, flows: FlowRow[], from: string, to: string): ScheduleGaps {
  const months = terms.frequency ? PERIOD_MONTHS[terms.frequency] : undefined
  const expected: string[] = []
  if (months && terms.est !== 'Cupon Cero' && !NON_PERIODIC_FC.includes(terms.frequency!)) {
    for (let k = 0; ; k--) {
      const d = addMonths(terms.accrualStart, k * months)
      if (d <= terms.issueDate) break
      expected.push(d)
    }
    for (let k = 1; ; k++) {
      const d = addMonths(terms.accrualStart, k * months)
      if (d >= to) break
      expected.push(d)
    }
  }
  const missingDates = expected
    .filter((d) => d >= from && d < to && !flows.some((f) => daysApart(f.date, d) <= SAME_PAYMENT_DAYS))
    .sort()
  const known = flows.filter((f) => f.date < to).reduce((sum, f) => sum + f.amo, 0)
  const unexplainedAmortization = Math.max(0, round6(100 - terms.residualPct - known))
  return { missingDates, unexplainedAmortization }
}

type Row = Record<string, unknown>
const toRows = (data: Row[] | null): FlowRow[] =>
  (data ?? []).map((r) => ({ date: r.flow_date as string, ren: Number(r.ren), amo: Number(r.amo) }))
const toHistoryRows = (data: Row[] | null): HistoryRow[] =>
  (data ?? []).map((r) => ({ date: r.flow_date as string, ren: Number(r.ren), amo: Number(r.amo), firstSeenAsOf: r.first_seen_as_of as string, lastSeenAsOf: r.last_seen_as_of as string, source: r.source as string }))

/** Both public tables for one ISIN. Throws on any read error: a partial schedule is worse than none. */
export async function loadFlowRows(sb: SupabaseClient, isin: string): Promise<{ history: HistoryRow[]; current: FlowRow[] }> {
  const read = async (table: string, cols: string) => {
    const { data, error } = await sb.from(table).select(cols).eq('isin', isin).order('flow_date')
    if (error) throw new Error(`${table}: ${error.message}`)
    return data as unknown as Row[] | null
  }
  const [history, current] = await Promise.all([
    read('on_flow_history', 'flow_date, ren, amo, first_seen_as_of, last_seen_as_of, source'),
    read('on_cashflows', 'flow_date, ren, amo'),
  ])
  return { history: toHistoryRows(history), current: toRows(current) }
}
