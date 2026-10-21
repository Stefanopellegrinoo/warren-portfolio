// Pure yield analytics on top of buildFlows (no DB, no network).
// Yields are decimals (0.0725 = 7.25%). Prices are dirty, per 100 ORIGINAL VN,
// like BYMA px. Discounting is effective annual ACT/365 from the settlement
// date to the business-day-adjusted pay date (BYMA TIR e.a. = XIRR); the day
// count only drives accrual.
import { actualDays, dcf, type DayCount, type Flow } from './bond-math'

interface Cash {
  t: number // years from settle
  cf: number
  amort: number
}

// Flows still ahead of settle. A coupon whose record date has passed is
// excluded (ex-coupon); the amortization on that date is kept.
function liveCash(flows: Flow[], settle: string): Cash[] {
  return flows
    .filter((f) => f.payDate > settle)
    .map((f) => {
      const coupon = settle > f.recordDate ? 0 : f.couponPct
      return { t: actualDays(settle, f.payDate) / 365, cf: coupon + f.amortPct, amort: f.amortPct }
    })
}

const pv = (cash: Cash[], y: number) => cash.reduce((s, c) => s + c.cf * Math.pow(1 + y, -c.t), 0)

// Newton inside a bracket, bisection when a step leaves it. pv is strictly
// decreasing in y, so the bracket always holds the root if there is one.
function solve(cash: Cash[], px: number): number | null {
  let lo = -0.99
  let hi = 10
  if (pv(cash, lo) < px || pv(cash, hi) > px) return null
  let y = 0.05
  for (let i = 0; i < 100; i++) {
    const f = pv(cash, y) - px
    if (Math.abs(f) < 1e-12) return y
    if (f > 0) lo = y
    else hi = y
    const slope = cash.reduce((s, c) => s - (c.t * c.cf) * Math.pow(1 + y, -c.t - 1), 0)
    const next = y - f / slope
    y = next > lo && next < hi ? next : (lo + hi) / 2
  }
  return y
}

export function ytm(dirtyPx: number, flows: Flow[], settle: string): number | null {
  const cash = liveCash(flows, settle)
  if (!(dirtyPx > 0) || cash.length === 0) return null
  return solve(cash, dirtyPx)
}

export interface Risk {
  ytm: number
  macaulay: number
  modified: number
  convexity: number
}

export function risk(dirtyPx: number, flows: Flow[], settle: string): Risk | null {
  const y = ytm(dirtyPx, flows, settle)
  if (y === null) return null
  const cash = liveCash(flows, settle)
  const price = pv(cash, y)
  const macaulay = cash.reduce((s, c) => s + c.t * c.cf * Math.pow(1 + y, -c.t), 0) / price
  const convexity =
    cash.reduce((s, c) => s + c.t * (c.t + 1) * c.cf * Math.pow(1 + y, -c.t - 2), 0) / price
  return { ytm: y, macaulay, modified: macaulay / (1 + y), convexity }
}

// accrued = nextCoupon x DCF(prev, settle) / DCF(prev, next) on unadjusted
// dates. Past the record date it turns negative: -nextCoupon x
// DCF(settle, next) / DCF(prev, next). Zero when there is no next flow.
export function accrued(flows: Flow[], settle: string, dc: DayCount, issueDate: string): number {
  const i = flows.findIndex((f) => f.date > settle)
  if (i < 0) return 0
  const prev = i > 0 ? flows[i - 1].date : issueDate
  const next = flows[i]
  if (settle <= prev) return 0
  const period = dcf(dc, prev, next.date)
  if (period === 0) return 0
  if (settle > next.recordDate) return (-next.couponPct * dcf(dc, settle, next.date)) / period
  return (next.couponPct * dcf(dc, prev, settle)) / period
}

// Weighted average life from settle, by amortization amount.
export function wal(flows: Flow[], settle: string): number | null {
  const cash = liveCash(flows, settle)
  const total = cash.reduce((s, c) => s + c.amort, 0)
  if (total === 0) return null
  return cash.reduce((s, c) => s + c.t * c.amort, 0) / total
}

export interface AnalyzeInput {
  dirtyPx: number
  flows: Flow[]
  settle: string
  dayCount: DayCount
  issueDate: string
  couponPct: number // annual nominal rate in %, for current yield
  floating?: boolean
}

export type Analytics =
  | { ok: false; reason: 'floating' | 'no-price' | 'no-flows' }
  | ({ ok: true; dirty: number; clean: number; accrued: number; paridad: number; currentYield: number; wal: number | null } & Risk)

export function analyze(input: AnalyzeInput): Analytics {
  const { dirtyPx, flows, settle } = input
  if (input.floating) return { ok: false, reason: 'floating' }
  if (!(dirtyPx > 0)) return { ok: false, reason: 'no-price' }
  const r = risk(dirtyPx, flows, settle)
  const next = flows.find((f) => f.date > settle)
  if (!r || !next) return { ok: false, reason: 'no-flows' }
  const acc = accrued(flows, settle, input.dayCount, input.issueDate)
  const clean = dirtyPx - acc
  return {
    ok: true,
    ...r,
    dirty: dirtyPx,
    accrued: acc,
    clean,
    paridad: dirtyPx / (next.residualBeforePct + acc),
    // On CLEAN price (BYMA's cy divides by dirty).
    currentYield: (input.couponPct * next.residualBeforePct) / 100 / clean,
    wal: wal(flows, settle),
  }
}
