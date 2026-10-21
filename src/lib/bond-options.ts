// Embedded call options (yield-to-call / yield-to-worst) and the optional
// spread over the sovereign curve. Pure; change-of-control and tax calls are
// contingent and shown as text only, so they never reach this module.
import type { DayCount, Flow } from './bond-math'
import { accrued, ytm } from './bond-yield'

export interface CallWindow {
  from: string
  to: string | null // null = open-ended
  pricePct: number // % of the residual
}

export interface Worst {
  ytw: number
  workoutDate: string
  kind: 'maturity' | 'call'
}

// Candidate call dates: each window start still ahead of settle, and each
// coupon date inside a window. A window that started before settle only
// contributes its coupon dates (a call ON settle has zero tenor).
// Redemption = pricePct x residual + coupon accrued to that date.
export function yieldToWorst(
  dirtyPx: number,
  flows: Flow[],
  calls: CallWindow[],
  settle: string,
  dc: DayCount,
  issueDate: string
): Worst | null {
  const maturity = ytm(dirtyPx, flows, settle)
  if (maturity === null) return null
  let worst: Worst = { ytw: maturity, workoutDate: flows[flows.length - 1].date, kind: 'maturity' }
  const inWindow = (w: CallWindow, d: string) => d >= w.from && (w.to === null || d <= w.to)

  for (const w of calls) {
    const dates = new Set<string>()
    if (w.from > settle) dates.add(w.from)
    for (const f of flows) if (f.date > settle && inWindow(w, f.date)) dates.add(f.date)
    for (const date of dates) {
      const hit = flows.find((f) => f.date === date)
      const before = flows.filter((f) => f.date < date)
      const residual = hit?.residualBeforePct ?? flows.find((f) => f.date > date)?.residualBeforePct
      if (residual === undefined) continue
      const call: Flow = {
        date,
        payDate: hit?.payDate ?? date,
        recordDate: hit?.recordDate ?? date,
        couponPct: hit?.couponPct ?? accrued(flows, date, dc, issueDate),
        amortPct: (w.pricePct * residual) / 100,
        residualBeforePct: residual,
        couponSource: hit?.couponSource ?? 'computed',
      }
      const y = ytm(dirtyPx, [...before, call], settle)
      if (y !== null && y < worst.ytw) worst = { ytw: y, workoutDate: date, kind: 'call' }
    }
  }
  return worst
}

export interface CurvePoint {
  duration: number
  ytm: number
}

// Our YTM minus the sovereign YTM interpolated linearly by modified duration.
// Null with no curve or when the duration is outside the curve's range.
export function interpolateSpread(ourYtm: number, modDuration: number, curve: CurvePoint[]): number | null {
  const pts = [...curve].sort((a, b) => a.duration - b.duration)
  if (pts.length === 0 || modDuration < pts[0].duration || modDuration > pts[pts.length - 1].duration) return null
  const i = pts.findIndex((p) => p.duration >= modDuration)
  const hi = pts[i]
  const lo = i > 0 ? pts[i - 1] : hi
  const base =
    hi.duration === lo.duration
      ? hi.ytm
      : lo.ytm + ((hi.ytm - lo.ytm) * (modDuration - lo.duration)) / (hi.duration - lo.duration)
  return ourYtm - base
}
