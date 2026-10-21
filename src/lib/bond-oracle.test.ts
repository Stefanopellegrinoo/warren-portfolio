// Oracle: our solver vs BYMA Educa's own published ytm (public bond data, 2026-10-20).
// Fixture: scripts/build-byma-oracle-fixture.ts. Prices are dirty per 100 ORIGINAL VN.
import { describe, expect, it } from 'vitest'
import fixture from './__fixtures__/byma-oracle.json'
import { buildFlows, defaultDayCount, type DayCount, type RawFlow } from './bond-math'
import { accrued, ytm } from './bond-yield'

interface Row {
  tk: string
  isin: string
  ley: 'ARG' | 'NY'
  est: string
  fe: string
  cup: number
  px: number
  ai: number
  ytm: number
  ren: [string, number][]
  amo: [string, number][]
}
const rows = fixture.rows as unknown as Row[]
const settle = fixture.settle

const bymaRaw = (r: Row): RawFlow[] => [
  ...r.ren.map(([date, ren]) => ({ date, ren, amo: 0 })),
  ...r.amo.map(([date, amo]) => ({ date, ren: 0, amo })),
]
// BYMA discounts on the UNADJUSTED dates (adjusting moves 10+ ARG-law bonds by 1-2bp).
const unadjusted = { isBusinessDay: () => true, adjust: (d: string) => d }
const bymaTerms = { issueDate: '', rateType: 'byma', couponPct: 0, dayCount: '30/360', bdc: 'following', maturityBdc: 'following', recordOffsetDays: null } as const
const deltasBp = (flowsOf: (r: Row) => ReturnType<typeof buildFlows>, subset: Row[]) =>
  subset.map((r) => {
    const y = ytm(r.px, flowsOf(r), settle)
    return { tk: r.tk, bp: y === null ? Infinity : Math.abs(y * 100 - r.ytm) * 100 }
  })
const addMonths = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + n, d)).toISOString().slice(0, 10)
}
const monthsBetween = (a: string, b: string) =>
  (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7))
const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]
const stats = (d: { bp: number }[]) => {
  const v = d.map((x) => x.bp)
  return { n: v.length, median: q(v, 0.5), p90: q(v, 0.9), max: Math.max(...v) }
}

describe('BYMA oracle fixture', () => {
  it('has >= 200 public fixed-rate-or-bullet USD rows and only public fields', () => {
    expect(rows.length).toBeGreaterThanOrEqual(200)
    const allowed = ['tk', 'isin', 'ley', 'me', 'est', 'fe', 'fv', 'cup', 'px', 'ai', 'ytm', 'dm', 'ren', 'amo', 'vr']
    for (const r of rows) expect(Object.keys(r).sort()).toEqual([...allowed].sort())
  })

  it('method check: our ytm on BYMA flows reproduces BYMA ytm', () => {
    const d = deltasBp((r) => buildFlows({ ...bymaTerms, issueDate: r.fe }, bymaRaw(r), unadjusted), rows)
    const s = stats(d)
    // Measured 2026-10-20: n=228, median 0.004bp, p90 1.39bp. The max (~238bp, BYCWO) and
    // the tail are bonds with a long first period: BYMA `ren` lists a regular coupon while
    // its own ytm uses the real (longer) first coupon, so our result on those flows differs.
    expect(s.n).toBeGreaterThanOrEqual(200)
    expect(s.median).toBeLessThanOrEqual(0.5)
    expect(s.p90).toBeLessThanOrEqual(2)
  })

  // BYMA `ren` only lists FUTURE coupons, so the accrual period that contains settle
  // starts at the last regular cycle date <= settle (clamped to the issue date).
  // ponytail: cycle length = gap between the first two coupons (6 months if only one).
  const periodStart = (r: Row) => {
    const gap = r.ren.length > 1 ? monthsBetween(r.ren[0][0], r.ren[1][0]) : 6
    let k = 0
    let cand = r.ren[0][0]
    while (cand > settle) cand = addMonths(r.ren[0][0], -gap * ++k)
    return cand > r.fe ? cand : r.fe
  }
  const fixed = rows.filter((r) => r.est === 'Tasa Fija' && r.cup > 0 && r.ren.length > 0)
  const termsOf = (r: Row, dayCount: DayCount) => ({
    issueDate: periodStart(r),
    rateType: 'fixed' as const,
    couponPct: r.cup * 100,
    dayCount,
    bdc: 'following' as const,
    maturityBdc: 'following' as const,
    recordOffsetDays: null,
  })

  it('terms check: default day count by law is informational', () => {
    const flowsOf = (r: Row) => buildFlows(termsOf(r, defaultDayCount(r.ley)), bymaRaw(r))
    const ny = stats(deltasBp(flowsOf, fixed.filter((r) => r.ley === 'NY')))
    const arg = stats(deltasBp(flowsOf, fixed.filter((r) => r.ley === 'ARG')))
    // Measured: NY 30/360 median 0.28bp (35 of 42 within 1bp), so terms == method for
    // regular NY bonds. ARG ACT/365 differs from BYMA's cup/2 (median 1.5bp, long tail
    // from period-start inference); never thresholded, only sanity bounds.
    expect(ny.n).toBeGreaterThan(30)
    expect(arg.n).toBeGreaterThan(100)
    expect(ny.median).toBeLessThanOrEqual(1)
    expect(arg.median).toBeLessThanOrEqual(10)
  })

  it('accrued: BYMA ai is cup x 30/360 days since the period start', () => {
    const near = fixed.filter((r) => {
      const flows = buildFlows(termsOf(r, '30/360'), bymaRaw(r))
      return Math.abs(accrued(flows, settle, '30/360', periodStart(r)) - r.ai) < 0.02
    })
    // Measured 185/212 within 0.02 (the rest are irregular first periods / single coupons),
    // against 70/212 for ACT/360. So BYMA ai is 30/360 even for ACT/365 ARG bonds
    // (CS50: 0.8257 = 7.25 x 41/360 vs ours 7.25 x 41/365 = 0.8144).
    expect(near.length / fixed.length).toBeGreaterThanOrEqual(0.8)
  })
})
