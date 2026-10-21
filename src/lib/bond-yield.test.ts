import { describe, it, expect } from 'vitest'
import type { Flow } from './bond-math'
import { ytm, accrued, risk, wal, analyze } from './bond-yield'

// Synthetic flows: payDate = date unless given; recordDate = date unless given.
function flow(date: string, couponPct: number, amortPct: number, residualBeforePct = 100, extra: Partial<Flow> = {}): Flow {
  return { date, payDate: date, recordDate: date, couponPct, amortPct, residualBeforePct, couponSource: 'computed', ...extra }
}

const SETTLE = '2026-01-01'

describe('ytm', () => {
  it('single flow one year out at 110 for price 100 -> 10% effective annual', () => {
    expect(ytm(100, [flow('2027-01-01', 10, 100)], SETTLE)).toBeCloseTo(0.1, 10)
  })

  it('two-flow bond priced at par yields its coupon', () => {
    const flows = [flow('2027-01-01', 8, 0), flow('2028-01-01', 8, 100)]
    expect(ytm(100, flows, SETTLE)).toBeCloseTo(0.08, 10)
  })

  it('excludes a flow whose pay date is the settlement date', () => {
    const flows = [flow(SETTLE, 5, 0), flow('2027-01-01', 10, 100)]
    expect(ytm(100, flows, SETTLE)).toBeCloseTo(0.1, 10)
  })

  it('discounts from the holiday-adjusted pay date, not the unadjusted date', () => {
    // 2027-01-02 is a Saturday, paid Monday 2027-01-04: 368 days from settle.
    const px = 110 / Math.pow(1.1, 368 / 365)
    const flows = [flow('2027-01-02', 10, 100, 100, { payDate: '2027-01-04' })]
    expect(ytm(px, flows, SETTLE)).toBeCloseTo(0.1, 10)
  })

  it('returns null for a non-positive price or no future flows', () => {
    expect(ytm(0, [flow('2027-01-01', 10, 100)], SETTLE)).toBeNull()
    expect(ytm(-5, [flow('2027-01-01', 10, 100)], SETTLE)).toBeNull()
    expect(ytm(100, [flow('2025-01-01', 10, 100)], SETTLE)).toBeNull()
  })

  it('drops the next coupon (not the amortization) when settle is past the record date', () => {
    const ex = [
      flow('2026-03-31', 5, 0, 100, { recordDate: '2026-03-16' }),
      flow('2027-03-31', 5, 100),
    ]
    const withoutCoupon = [flow('2026-03-31', 0, 0), flow('2027-03-31', 5, 100)]
    expect(ytm(98, ex, '2026-03-20')).toBeCloseTo(ytm(98, withoutCoupon, '2026-03-20')!, 12)
    // before the record date the coupon is still ours
    expect(ytm(98, ex, '2026-03-10')).toBeGreaterThan(ytm(98, withoutCoupon, '2026-03-10')!)
  })
})

describe('risk', () => {
  it('zero coupon: Macaulay = t, modified = t/(1+y), convexity = t(t+1)/(1+y)^2', () => {
    const y = Math.sqrt(100 / 80) - 1
    const r = risk(80, [flow('2028-01-01', 0, 100)], SETTLE)!
    expect(r.ytm).toBeCloseTo(y, 9)
    expect(r.macaulay).toBeCloseTo(730 / 365, 9)
    expect(r.modified).toBeCloseTo(2 / (1 + y), 9)
    expect(r.convexity).toBeCloseTo(6 / (1 + y) ** 2, 9)
  })

  it('returns null when the yield is undefined', () => {
    expect(risk(0, [flow('2028-01-01', 0, 100)], SETTLE)).toBeNull()
  })
})

describe('accrued', () => {
  const issue = '2025-12-10'
  const cs50 = [
    flow('2026-09-10', (7.25 * 274) / 365, 0),
    flow('2027-03-10', (7.25 * 181) / 365, 100),
  ]

  it('CS50 ACT/365: 41 days after the Sep coupon = 7.25 x 41/365 (not BYMA 30/360)', () => {
    expect(accrued(cs50, '2026-10-21', 'ACT/365', issue)).toBeCloseTo((7.25 * 41) / 365, 9)
  })

  it('is zero when settle is the previous coupon date', () => {
    expect(accrued(cs50, '2026-09-10', 'ACT/365', issue)).toBe(0)
  })

  it('first period accrues from the issue date', () => {
    expect(accrued(cs50, '2026-01-09', 'ACT/365', issue)).toBeCloseTo(((7.25 * 274) / 365 * 30) / 274, 9)
  })

  it('amortizing bond: accrues on the residual coupon', () => {
    const flows = [
      flow('2026-07-15', 4, 33),
      flow('2027-01-15', 2.68, 33, 67),
      flow('2027-07-15', 1.36, 34, 34),
    ]
    expect(accrued(flows, '2026-10-15', '30/360', '2026-01-15')).toBeCloseTo((2.68 * 0.25) / 0.5, 9)
  })

  describe('ex-coupon (record date 15 calendar days before)', () => {
    const rec = [
      flow('2026-09-10', 3.6, 0, 100, { recordDate: '2026-08-26' }),
      flow('2027-03-10', 3.6, 100, 100, { recordDate: '2027-02-23' }),
    ]
    it('is negative after the record date: -coupon x DCF(settle,next)/DCF(prev,next)', () => {
      expect(accrued(rec, '2027-02-24', 'ACT/365', '2025-12-10')).toBeCloseTo((-3.6 * 14) / 181, 9)
    })
    it('settle ON the record date is still cum-coupon (positive)', () => {
      expect(accrued(rec, '2027-02-23', 'ACT/365', '2025-12-10')).toBeCloseTo((3.6 * 166) / 181, 9)
    })
  })

  it('null record offset (record = pay date): never negative', () => {
    expect(accrued(cs50, '2027-03-09', 'ACT/365', issue)).toBeGreaterThan(0)
  })

  it('is zero after the last flow', () => {
    expect(accrued(cs50, '2028-01-01', 'ACT/365', issue)).toBe(0)
  })
})

describe('wal', () => {
  it('bullet: time to maturity', () => {
    expect(wal([flow('2028-01-01', 5, 100)], SETTLE)).toBeCloseTo(2, 9)
  })
  it('amortizing 33/33/34: amount-weighted time', () => {
    const flows = [flow('2027-01-01', 0, 33), flow('2028-01-01', 0, 33), flow('2029-01-01', 0, 34)]
    expect(wal(flows, SETTLE)).toBeCloseTo((33 * 365 + 33 * 730 + 34 * 1096) / 365 / 100, 9)
  })
  it('null with no future amortization', () => {
    expect(wal([flow('2025-01-01', 0, 100)], SETTLE)).toBeNull()
  })
})

describe('analyze', () => {
  const issue = '2025-12-10'
  const flows = [
    flow('2026-09-10', (7.25 * 274) / 365, 0),
    flow('2027-03-10', (7.25 * 181) / 365, 0),
    flow('2028-03-10', 7.25 * (366 / 365), 100),
  ]
  const input = { dirtyPx: 103, flows, settle: '2026-10-21', dayCount: 'ACT/365' as const, issueDate: issue, couponPct: 7.25 }

  it('derives clean, paridad and current yield on CLEAN', () => {
    const a = analyze(input)
    if (!a.ok) throw new Error('expected ok')
    const acc = (7.25 * 41) / 365
    expect(a.accrued).toBeCloseTo(acc, 9)
    expect(a.clean).toBeCloseTo(103 - acc, 9)
    expect(a.paridad).toBeCloseTo(103 / (100 + acc), 9)
    expect(a.currentYield).toBeCloseTo((0.0725 * 100) / 100 / ((103 - acc) / 100) / 1, 9)
    expect(a.ytm).toBeGreaterThan(0)
    expect(a.wal).toBeGreaterThan(1)
  })

  it('refuses floating-rate bonds', () => {
    expect(analyze({ ...input, floating: true })).toEqual({ ok: false, reason: 'floating' })
  })

  it('types a missing price instead of throwing', () => {
    expect(analyze({ ...input, dirtyPx: 0 })).toEqual({ ok: false, reason: 'no-price' })
  })
})
