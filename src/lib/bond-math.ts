// Pure bond math (no DB, no network). Dates are ISO 'YYYY-MM-DD' strings,
// handled through UTC arithmetic only, so results do not depend on the TZ.
// Percentages are per 100 ORIGINAL face value (VN), like BYMA px/ren/amo.
import { arCalendar, addDays, type Bdc, type Calendar } from './ar-calendar'

export type { Bdc } from './ar-calendar'
export type DayCount = '30/360' | 'ACT/365' | 'ACT/360' | 'ACT/ACT'
// verified: curated override with verified_at; secondary: override without it;
// byma: taken from BYMA; default: our per-law fallback. secondary/default = "sin verificar".
export type Prov = 'verified' | 'secondary' | 'byma' | 'default'

export interface Flow {
  date: string // unadjusted; accrual runs on this
  payDate: string // business-day adjusted; discounting and proposals use this
  recordDate: string
  couponPct: number
  amortPct: number
  residualBeforePct: number
  couponSource: 'computed' | 'byma'
}

// BYMA row: ren is already scaled to the residual, amo is % of original VN.
export interface RawFlow {
  date: string
  ren: number
  amo: number
}

export interface FlowTerms {
  issueDate: string
  // fixed: coupons are computed; byma: step-up/other, BYMA ren used as given.
  rateType: 'fixed' | 'byma'
  couponPct: number // annual nominal rate in %, e.g. 7.25
  dayCount: DayCount
  bdc: Bdc
  maturityBdc: Bdc
  recordOffsetDays: number | null
}

const DAY_MS = 86_400_000

function toMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function actualDays(from: string, to: string): number {
  return Math.round((toMs(to) - toMs(from)) / DAY_MS)
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

function daysThrough(year: number, iso: string): number {
  return actualDays(`${year}-01-01`, iso)
}

function actAct(from: string, to: string): number {
  const y1 = Number(from.slice(0, 4))
  const y2 = Number(to.slice(0, 4))
  const yearLen = (y: number) => (isLeap(y) ? 366 : 365)
  if (y1 === y2) return actualDays(from, to) / yearLen(y1)
  const head = (yearLen(y1) - daysThrough(y1, from)) / yearLen(y1)
  const tail = daysThrough(y2, to) / yearLen(y2)
  return head + (y2 - y1 - 1) + tail
}

function thirty360(from: string, to: string): number {
  const [y1, m1, d1raw] = from.split('-').map(Number)
  const [y2, m2, d2raw] = to.split('-').map(Number)
  const d1 = Math.min(d1raw, 30)
  const d2 = d2raw === 31 && d1 === 30 ? 30 : d2raw
  return (360 * (y2 - y1) + 30 * (m2 - m1) + (d2 - d1)) / 360
}

// Day count fraction between two unadjusted dates (from < to).
export function dcf(dc: DayCount, from: string, to: string): number {
  if (from === to) return 0
  if (dc === '30/360') return thirty360(from, to)
  if (dc === 'ACT/360') return actualDays(from, to) / 360
  if (dc === 'ACT/ACT') return actAct(from, to)
  return actualDays(from, to) / 365
}

// ARG law: ACT/365 (CS50, DNCB, CT Barragan prospectuses). NY law: 30/360
// (144A/Reg S practice). Callers tag the result with provenance 'default'.
export function defaultDayCount(law: 'ARG' | 'NY'): DayCount {
  return law === 'ARG' ? 'ACT/365' : '30/360'
}

// Fixed-rate coupons are computed (cup x DCF x residual); the first period
// starts at the issue date. Zero-amortization schedules get a 100% bullet
// redemption on the last date.
export function buildFlows(
  terms: FlowTerms,
  raw: RawFlow[],
  cal: Calendar = arCalendar
): Flow[] {
  const rows = [...raw].sort((a, b) => a.date.localeCompare(b.date))
  const needsBullet = rows.every((r) => r.amo === 0)
  let residual = 100
  let prev = terms.issueDate
  return rows.map((row, i) => {
    const isLast = i === rows.length - 1
    const amortPct = needsBullet && isLast ? 100 : row.amo
    const computed = terms.rateType === 'fixed'
    const couponPct = computed
      ? (terms.couponPct * dcf(terms.dayCount, prev, row.date) * residual) / 100
      : row.ren
    const flow: Flow = {
      date: row.date,
      payDate: cal.adjust(row.date, isLast ? terms.maturityBdc : terms.bdc),
      recordDate: addDays(row.date, -(terms.recordOffsetDays ?? 0)),
      couponPct,
      amortPct,
      residualBeforePct: residual,
      couponSource: computed ? 'computed' : 'byma',
    }
    residual -= amortPct
    prev = row.date
    return flow
  })
}
