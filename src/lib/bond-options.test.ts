import { describe, it, expect } from 'vitest'
import type { Flow } from './bond-math'
import { ytm } from './bond-yield'
import { yieldToWorst, interpolateSpread } from './bond-options'

function flow(date: string, couponPct: number, amortPct: number, residualBeforePct = 100): Flow {
  return { date, payDate: date, recordDate: date, couponPct, amortPct, residualBeforePct, couponSource: 'computed' }
}

const SETTLE = '2026-01-01'
const flows = [flow('2027-01-01', 10, 0), flow('2028-01-01', 10, 100)]
const ISSUE = '2026-01-01'

describe('yieldToWorst', () => {
  it('keeps maturity when the call yields more (bond below the call price)', () => {
    const calls = [{ from: '2027-01-01', to: null, pricePct: 103.75 }]
    const w = yieldToWorst(95, flows, calls, SETTLE, 'ACT/365', ISSUE)!
    expect(w.kind).toBe('maturity')
    expect(w.workoutDate).toBe('2028-01-01')
    expect(w.ytw).toBeCloseTo(ytm(95, flows, SETTLE)!, 12)
  })

  it('picks the call when the price is above the call price', () => {
    const calls = [
      { from: '2027-01-01', to: '2027-12-31', pricePct: 103.75 },
      { from: '2028-01-01', to: null, pricePct: 101.875 },
    ]
    const w = yieldToWorst(108, flows, calls, SETTLE, 'ACT/365', ISSUE)!
    expect(w.kind).toBe('call')
    expect(w.workoutDate).toBe('2027-01-01')
    expect(w.ytw).toBeCloseTo(113.75 / 108 - 1, 9)
  })

  it('uses a window start between coupons, redeeming at price + accrued to that date', () => {
    const calls = [{ from: '2026-07-01', to: '2026-12-31', pricePct: 102 }]
    const w = yieldToWorst(107, flows, calls, SETTLE, 'ACT/365', ISSUE)!
    const redemption = 102 + (10 * 181) / 365
    expect(w.kind).toBe('call')
    expect(w.workoutDate).toBe('2026-07-01')
    expect(w.ytw).toBeCloseTo(Math.pow(redemption / 107, 365 / 181) - 1, 9)
  })

  it('ignores an expired window', () => {
    const calls = [{ from: '2025-01-01', to: '2025-12-31', pricePct: 150 }]
    expect(yieldToWorst(108, flows, calls, SETTLE, 'ACT/365', ISSUE)!.kind).toBe('maturity')
  })

  it('no calls (e.g. change-of-control is text only): maturity', () => {
    expect(yieldToWorst(108, flows, [], SETTLE, 'ACT/365', ISSUE)!.kind).toBe('maturity')
  })

  it('returns null when the yield is undefined', () => {
    expect(yieldToWorst(0, flows, [], SETTLE, 'ACT/365', ISSUE)).toBeNull()
  })
})

describe('interpolateSpread', () => {
  const curve = [
    { duration: 4, ytm: 0.07 },
    { duration: 2, ytm: 0.05 },
  ]
  it('interpolates linearly by modified duration', () => {
    expect(interpolateSpread(0.09, 3, curve)).toBeCloseTo(0.03, 12)
  })
  it('works at a curve endpoint', () => {
    expect(interpolateSpread(0.08, 2, curve)).toBeCloseTo(0.03, 12)
  })
  it('is null without a curve or outside its range', () => {
    expect(interpolateSpread(0.09, 3, [])).toBeNull()
    expect(interpolateSpread(0.09, 5, curve)).toBeNull()
    expect(interpolateSpread(0.09, 1, curve)).toBeNull()
  })
})
