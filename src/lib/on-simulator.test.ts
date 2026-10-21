import { describe, it, expect } from 'vitest'
import { simulateOn, type SimParams } from './on-simulator'
import { analyzeOn, type OnInput, type TermsRow } from './on-analytics'
import type { OverrideRow } from './on-terms'

// Synthetic amortizing ON (100 -> 67 -> 34 -> 0), NY law (30/360), 6% semiannual.
// Accrual starts on the settlement date, so accrued interest is zero and every figure is hand-checkable.
const ISIN = 'AR0000000001'
const TODAY = '2026-10-21' // Wednesday: T+1 settlement is Thursday 2026-10-22
const terms = (over: Partial<TermsRow> = {}): TermsRow => ({
  isin: ISIN, tickerO: 'TSTAO', tickerD: 'TSTAD', tickerC: 'TSTAC', issuer: 'Emisor de Prueba S.A.', description: 'ON Clase A',
  law: 'NY', currency: 'USD', paymentPlaza: 'CCL', est: 'Tasa Fija', frequency: 'Semestral',
  issueDate: '2026-04-22', maturityDate: '2028-04-22', couponRate: 0.06, residualPct: 100, accrualStart: '2026-10-22',
  issuedAmountByma: null, adtvO: null, adtvD: null, adtvC: null, asOf: '2026-10-20', ...over,
})
// 2028-04-22 is a Saturday: the adjusted pay date moves to Monday 24.
const flows = [
  { date: '2027-04-22', ren: 3, amo: 33 },
  { date: '2027-10-22', ren: 2, amo: 33 },
  { date: '2028-04-22', ren: 1, amo: 34 },
]
const ov = (field: string, value: unknown): OverrideRow => ({ isin: ISIN, field, value, sourceUrl: 'https://example.org/p.pdf', verifiedAt: '2026-10-01' })
const analysis = (over: Partial<OnInput> = {}) =>
  analyzeOn({ terms: terms(), flows, overrides: [], events: [], check: null, curve: [], price: 98, settle: '2026-10-22', ...over })
const sim = (p: Partial<SimParams> = {}, a = analysis()) => simulateOn({ analysis: a, mode: 'usd', amount: 10_000, today: TODAY, ...p })
const okSim = (p: Partial<SimParams> = {}, a = analysis()) => {
  const r = sim(p, a)
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}: ${r.message}`)
  return r
}

describe('simulateOn: buying', () => {
  it('USD amount -> VN at the dirty price; quantity = VN/100', () => {
    const r = okSim()
    // 10,000 / 0.98 = 10,204.08 -> unknown lot: whole VN
    expect(r.vn).toBe(10_204)
    expect(r.quantity).toBeCloseTo(102.04, 10)
    expect(r.cost).toBeCloseTo(9_999.92, 6)
    expect(r.leftover).toBeCloseTo(0.08, 6)
    expect(r.priceSource).toBe('D')
    expect(r.pricePct).toBe(98)
    expect(r.settle).toBe('2026-10-22')
  })

  it('VN input derives the cost', () => {
    const r = okSim({ mode: 'vn', amount: 5_000 })
    expect(r.vn).toBe(5_000)
    expect(r.cost).toBeCloseTo(4_900, 6)
  })

  it('unknown lot: allowed from 1 VN with the notice', () => {
    const r = okSim({ mode: 'vn', amount: 1 })
    expect(r.vn).toBe(1)
    expect(r.lot.known).toBe(false)
    expect(r.notes.join(' ')).toContain('lámina mínima desconocida')
  })

  it('MGCR-like lot (min 10,000, step 1,000): 10,500 -> 10,000 with an explicit message', () => {
    const a = analysis({ price: 100, overrides: [ov('min_denomination', 10_000), ov('increment', 1_000)] })
    const r = okSim({ mode: 'vn', amount: 10_500 }, a)
    expect(r.vn).toBe(10_000)
    expect(r.lot).toMatchObject({ known: true, minVn: 10_000, incrementVn: 1_000 })
    expect(r.notes.join(' ')).toContain('redondeó hacia abajo')
    expect(okSim({ amount: 11_999 }, a).vn).toBe(11_000)
  })

  it('below the minimum: refused with "Mínimo: VN x" and no schedule', () => {
    const a = analysis({ price: 100, overrides: [ov('min_denomination', 10_000), ov('increment', 1_000)] })
    const r = sim({ mode: 'vn', amount: 9_000 }, a)
    expect(r).toMatchObject({ ok: false, reason: 'below-min' })
    expect(r.ok === false && r.message).toContain('Mínimo: VN 10.000')
    expect(sim({ amount: 9_000 }, a)).toMatchObject({ ok: false, reason: 'below-min' })
  })

  it('min trade unit counts as a minimum too (the larger one wins)', () => {
    const a = analysis({ price: 100, overrides: [ov('min_denomination', 1_000), ov('min_trade_unit', 5_000)] })
    expect(sim({ mode: 'vn', amount: 4_000 }, a)).toMatchObject({ ok: false, reason: 'below-min' })
    expect(okSim({ mode: 'vn', amount: 7_300 }, a).vn).toBe(7_300) // increment unknown: 1 VN
  })

  it.each([0, -5, NaN, Infinity])('invalid amount %s is refused', (amount) => {
    expect(sim({ amount })).toMatchObject({ ok: false, reason: 'bad-amount' })
  })
})

describe('simulateOn: payments', () => {
  it('amortizing: interest on the residual, amortization sums to VN, both dates, cumulative', () => {
    const r = okSim()
    const [p1, p2, p3] = r.payments
    expect(r.payments).toHaveLength(3)
    expect(p1).toMatchObject({ date: '2027-04-22', payDate: '2027-04-22', exCoupon: false })
    expect(p1.interest).toBeCloseTo(306.12, 6) // 10,204 x 6% x 0.5
    expect(p1.principal).toBeCloseTo(3_367.32, 6)
    expect(p1.total).toBeCloseTo(3_673.44, 6)
    expect(p2.interest).toBeCloseTo(205.1004, 6) // on the 67% residual
    expect(p3).toMatchObject({ date: '2028-04-22', payDate: '2028-04-24' }) // Saturday -> Monday
    expect(p3.interest).toBeCloseTo(104.0808, 6)
    expect(p3.cumulative).toBeCloseTo(r.totalCollected, 8)
    expect(r.totalPrincipal).toBeCloseTo(10_204, 6)
    expect(r.totalInterest).toBeCloseTo(615.3012, 6)
    expect(r.totalCollected).toBeCloseTo(10_819.3012, 6)
    expect(r.profit).toBeCloseTo(819.3812, 6)
  })

  it('payback: first payment whose cumulative total covers the cost', () => {
    expect(okSim().paybackDate).toBe('2028-04-24')
  })

  it('first coupon of a 9-month period reflects the full period (CS50 style)', () => {
    const a = analysis({ terms: terms({ accrualStart: '2026-07-22' }), price: 100 })
    const r = okSim({ mode: 'vn', amount: 1_000 }, a)
    expect(r.payments[0].interest).toBeCloseTo(45, 6) // 6% x 0.75 = 4.5 per 100 VN
  })

  it('zero-coupon: a single principal payment', () => {
    const a = analysis({ terms: terms({ est: 'Cupon Cero', couponRate: null }), flows: [{ date: '2028-04-22', ren: 0, amo: 0 }], price: 80 })
    const r = okSim({ mode: 'vn', amount: 1_000 }, a)
    expect(r.payments).toHaveLength(1)
    expect(r.payments[0]).toMatchObject({ interest: 0 })
    expect(r.payments[0].principal).toBeCloseTo(1_000, 6)
    expect(r.profit).toBeCloseTo(200, 6)
  })

  it('payments on or before settlement are excluded', () => {
    const r = okSim({ today: '2027-04-21' }) // settle = 2027-04-22 = first flow date
    expect(r.payments.map((p) => p.date)).toEqual(['2027-10-22', '2028-04-22'])
  })

  it('buying inside the record window: that coupon is excluded, amortization kept, and the note says so', () => {
    const a = analysis({ overrides: [ov('record_offset_days', 10)] })
    const r = okSim({ today: '2027-04-13', mode: 'vn', amount: 1_000 }, a) // record 2027-04-12, settle 2027-04-14
    const p1 = r.payments[0]
    expect(p1).toMatchObject({ date: '2027-04-22', exCoupon: true, interest: 0 })
    expect(p1.principal).toBeCloseTo(330, 6)
    expect(p1.skippedInterest).toBeCloseTo(30, 6) // 1,000 x 3%: goes to the seller
    expect(r.totalInterest).toBeCloseTo(20.1 + 10.2, 6)
    expect(r.notes.join(' ')).toContain('no cobrás el cupón')
  })

  it('the closing payment is never ex-coupon', () => {
    const a = analysis({ overrides: [ov('record_offset_days', 10)] })
    const r = okSim({ today: '2028-04-17', mode: 'vn', amount: 1_000 }, a) // inside the record window of the last flow
    expect(r.payments).toHaveLength(1)
    expect(r.payments[0].exCoupon).toBe(false)
  })
})

describe('simulateOn: yield, price and notes', () => {
  it('YTM at the price paid matches the analytics YTM', () => {
    const a = analysis()
    expect(okSim({}, a).ytmPct).toBeCloseTo(a.row.ytmPct!, 8)
  })

  it('manual price replaces the market price and is labelled', () => {
    const r = okSim({ manualPrice: 90 })
    expect(r.priceSource).toBe('manual')
    expect(r.pricePct).toBe(90)
    expect(r.ytmPct).toBeGreaterThan(okSim().ytmPct!)
  })

  it('no price and no manual price: refused', () => {
    expect(sim({}, analysis({ price: null }))).toMatchObject({ ok: false, reason: 'no-price' })
    expect(okSim({ manualPrice: 98 }, analysis({ price: null })).priceSource).toBe('manual')
  })

  it('floating-rate ON: "No simulable: tasa variable"', () => {
    const r = sim({}, analysis({ terms: terms({ est: 'Tasa Variable' }) }))
    expect(r).toMatchObject({ ok: false, reason: 'floating' })
    expect(r.ok === false && r.message).toBe('No simulable: tasa variable')
  })

  it('ON not in dollars: refused', () => {
    expect(sim({}, analysis({ terms: terms({ currency: 'ARS' }) }))).toMatchObject({ ok: false, reason: 'not-usd' })
  })

  it('accrued interest paid and the clean price are reported on the holding', () => {
    // accrual started 2026-07-22: 3 months to settle on 30/360 = 0.25 x 6 = 1.5 accrued per 100
    const a = analysis({ terms: terms({ accrualStart: '2026-07-22' }), price: 100 })
    const r = okSim({ mode: 'vn', amount: 1_000 }, a)
    expect(r.accruedPct).toBeCloseTo(1.5, 8)
    expect(r.accruedUsd).toBeCloseTo(15, 6)
  })

  it('callable ON: YTW and workout date next to YTM', () => {
    const a = analysis({ price: 104, overrides: [ov('calls', [{ from: '2027-04-22', to: null, pricePct: 100 }])] })
    const r = okSim({}, a)
    expect(r.ytw?.kind).toBe('call')
    expect(r.ytw!.ytwPct).toBeLessThan(r.ytmPct!)
    expect(r.ytw!.workoutDate).toBe('2027-04-22')
    expect(okSim({}, analysis()).ytw).toBeNull()
  })

  it('exposes the plaza and the price line so the UI can explain the purchase', () => {
    const r = okSim({}, analysis({ lines: { D: { px: 98, v: 5 } }, ccl: null }))
    expect(r.plaza).toBe('CCL')
    expect(r.priceLine).toBe('D')
    expect(r.lineFallback).toBe(true) // CCL ON priced on the D line: no canje in the price
  })

  it('is deterministic', () => {
    expect(sim()).toEqual(sim())
  })
})
