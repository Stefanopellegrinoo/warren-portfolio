import { describe, it, expect } from 'vitest'
import { analyzeOn, rateTypeOf, currencyLabel, type OnInput, type TermsRow } from './on-analytics'
import type { OverrideRow } from './on-terms'

// Synthetic bond: 6% annual, semiannual 3.0 coupons, bullet. NY law => 30/360 default.
// Accrual starts on the settle date, so accrued = 0 and dirty = clean.
const SETTLE = '2026-10-21'
const terms = (over: Partial<TermsRow> = {}): TermsRow => ({
  isin: 'AR0000000001',
  tickerO: 'TSTAO',
  tickerD: 'TSTAD',
  tickerC: 'TSTAC',
  issuer: 'Emisor de Prueba S.A.',
  description: 'ON Clase A',
  law: 'NY',
  currency: 'USD',
  paymentPlaza: 'MEP',
  est: 'Tasa Fija',
  frequency: 'Semestral',
  issueDate: SETTLE,
  maturityDate: '2029-10-22',
  couponRate: 0.06,
  residualPct: 100,
  accrualStart: SETTLE,
  issuedAmountByma: 50_000_000,
  adtvO: 1000,
  adtvD: 500,
  adtvC: null,
  asOf: '2026-10-20',
  ...over,
})
const flows = [
  { date: '2027-04-22', ren: 3, amo: 0 },
  { date: '2027-10-22', ren: 3, amo: 0 },
  { date: '2028-04-22', ren: 3, amo: 0 },
  { date: '2028-10-22', ren: 3, amo: 0 },
  { date: '2029-04-22', ren: 3, amo: 0 },
  { date: '2029-10-22', ren: 3, amo: 100 },
]
const input = (over: Partial<OnInput> = {}): OnInput => ({
  terms: terms(),
  flows,
  overrides: [],
  events: [],
  check: null,
  curve: [],
  price: 100,
  settle: SETTLE,
  ...over,
})
const ov = (field: string, value: unknown): OverrideRow => ({ isin: 'AR0000000001', field, value, sourceUrl: 'https://example.org/p.pdf', verifiedAt: '2026-10-01' })

describe('rate type and currency labels', () => {
  it('maps BYMA est to a rate type', () => {
    expect(rateTypeOf('Tasa Fija')).toBe('fixed')
    expect(rateTypeOf('Step Up')).toBe('step')
    expect(rateTypeOf('Cupon Cero')).toBe('zero')
    expect(rateTypeOf('Tasa Variable')).toBe('floating')
    expect(rateTypeOf(null)).toBe('other')
  })
  it('names the currency by plaza', () => {
    expect(currencyLabel('USD', 'MEP')).toBe('USD MEP')
    expect(currencyLabel('USD', 'CCL')).toBe('USD cable')
    expect(currencyLabel('USD', null)).toBe('USD')
    expect(currencyLabel('ARS', 'ARS')).toBe('ARS')
  })
})

describe('analyzeOn: priced fixed-rate USD ON', () => {
  const { row, detail } = analyzeOn(input())

  it('computes yield, duration, paridad and current yield at par', () => {
    expect(row.status).toBe('ok')
    expect(row.ytmPct).toBeCloseTo(6.09, 1) // 6% semiannual = 6.09% effective annual
    expect(row.mdYears).toBeGreaterThan(2.5)
    expect(row.mdYears).toBeLessThan(3)
    expect(row.paridadPct).toBeCloseTo(100, 6)
    expect(row.currentYieldPct).toBeCloseTo(6, 6)
    expect(row.walYears).toBeCloseTo(3, 1)
    expect(row.simulable).toBe(true)
    expect(row.price).toBe(100)
  })

  it('exposes the next payment on its adjusted date and the schedule', () => {
    expect(row.nextPayDate).toBe('2027-04-22')
    expect(row.nextPayAmountPct).toBeCloseTo((6 * 181) / 360, 6) // computed 30/360: 6 months + 1 day
    expect(detail.schedule).toHaveLength(6)
    expect(detail.schedule[5]).toMatchObject({ date: '2029-10-22', amortPct: 100, residualBeforePct: 100 })
  })

  it('reports clean, accrued and a source for each analytic', () => {
    expect(detail.accrued).toBeCloseTo(0, 9)
    expect(detail.clean).toBeCloseTo(100, 9)
    expect(detail.ytw).toBeNull() // no call options
  })

  it('shows the interest convention for this law as unverified default', () => {
    expect(detail.terms.dayCount).toEqual({ value: '30/360', prov: 'default' })
  })
})

describe('analyzeOn: missing or unusable price', () => {
  it('no price: terms and schedule still shown, price-based fields null', () => {
    const { row, detail } = analyzeOn(input({ price: null }))
    expect(row.status).toBe('no-price')
    expect([row.ytmPct, row.mdYears, row.paridadPct, row.currentYieldPct, row.spreadBp]).toEqual([null, null, null, null, null])
    expect(row.walYears).toBeNull()
    expect(detail.schedule).toHaveLength(6)
    expect(detail.clean).toBeNull()
  })

  it('an ARS ON never takes the USD price: no yield from a price in another currency', () => {
    const { row } = analyzeOn(input({ terms: terms({ currency: 'ARS', paymentPlaza: 'ARS' }), price: 100 }))
    expect(row.status).toBe('no-price')
    expect(row.ytmPct).toBeNull()
  })

  it('floating-rate ON: no analytics and not simulable, even with a price', () => {
    const { row } = analyzeOn(input({ terms: terms({ est: 'Tasa Variable' }), price: 100 }))
    expect(row.status).toBe('floating')
    expect(row.simulable).toBe(false)
    expect(row.ytmPct).toBeNull()
    expect(row.rateType).toBe('floating')
  })

  it('a matured/empty schedule gives no yield instead of throwing', () => {
    const { row } = analyzeOn(input({ flows: [] }))
    expect(row.status).toBe('no-yield')
    expect(row.nextPayDate).toBeNull()
  })
})

describe('analyzeOn: check disclosure (R3.8)', () => {
  const check = (over: object) => ({ asOf: '2026-10-20', bymaYtmPct: 6.0, methodYtmPct: 6.0, methodDiffBp: 0, termsYtmPct: 6.0, termsDiffBp: 0, flagged: false, ...over })

  it('flagged method check: both values and the date, never overriding ours', () => {
    const { row } = analyzeOn(input({ check: check({ flagged: true, methodDiffBp: 15, methodYtmPct: 6.15 }) }))
    expect(row.methodFlag).toEqual({ bymaYtmPct: 6.0, methodYtmPct: 6.15, diffBp: 15, asOf: '2026-10-20' })
    expect(row.ytmPct).toBeCloseTo(6.09, 1)
  })

  it('method diff within 5bp: no flag', () => {
    expect(analyzeOn(input({ check: check({ methodDiffBp: 0.3 }) })).row.methodFlag).toBeNull()
  })

  it('terms diff of 6bp with a clean method check: informational note only, no flag', () => {
    const { row } = analyzeOn(input({ check: check({ termsYtmPct: 6.06, termsDiffBp: 6 }) }))
    expect(row.methodFlag).toBeNull()
    expect(row.termsNote).toEqual({ bymaYtmPct: 6.0, termsYtmPct: 6.06, diffBp: 6, asOf: '2026-10-20' })
  })

  it('terms diff under 1bp: no note', () => {
    expect(analyzeOn(input({ check: check({ termsDiffBp: 0.4 }) })).row.termsNote).toBeNull()
  })
})

describe('analyzeOn: spread, liquidity, events, options', () => {
  const curve = [
    { law: 'NY' as const, ytmPct: 5, dm: 2 },
    { law: 'NY' as const, ytmPct: 6, dm: 4 },
    { law: 'ARG' as const, ytmPct: 9, dm: 3 },
  ]

  it('spread = our YTM minus the same-law sovereign YTM interpolated by modified duration', () => {
    const { row } = analyzeOn(input({ curve }))
    // md ~2.7 -> sovereign ~ 5 + (md-2)/2 ; spread ~ 6.09 - that
    const md = row.mdYears!
    const expected = (row.ytmPct! - (5 + (md - 2) / 2)) * 100
    expect(row.spreadBp).toBeCloseTo(expected, 4)
  })

  it('no same-law points or out of range: null', () => {
    expect(analyzeOn(input({ curve: [{ law: 'ARG', ytmPct: 9, dm: 3 }] })).row.spreadBp).toBeNull()
    expect(analyzeOn(input({ curve: [{ law: 'NY', ytmPct: 5, dm: 10 }] })).row.spreadBp).toBeNull()
  })

  it('ADTV adds the lines that have data; all missing is null', () => {
    expect(analyzeOn(input()).row.adtvUsd).toBe(1500)
    expect(analyzeOn(input({ terms: terms({ adtvO: null, adtvD: null, adtvC: null }) })).row.adtvUsd).toBeNull()
  })

  it('corporate events are carried to the row, newest first', () => {
    const e = (d: string, kind: string) => ({ kind, eventDate: d, note: null, sourceUrl: 'https://example.org/e', verifiedAt: null })
    const { row } = analyzeOn(input({ events: [e('2026-01-01', 'reapertura'), e('2026-06-01', 'canje')] }))
    expect(row.events.map((x) => x.kind)).toEqual(['canje', 'reapertura'])
    expect(analyzeOn(input()).row.events).toEqual([])
  })

  it('a call window cheaper than the price makes YTW a call', () => {
    const { detail, row } = analyzeOn(
      input({ price: 104, overrides: [ov('calls', [{ from: '2027-10-22', to: null, pricePct: 100 }])] })
    )
    expect(detail.ytw?.kind).toBe('call')
    expect(detail.ytw!.ytwPct).toBeLessThan(row.ytmPct!)
    expect(detail.terms.calls.prov).toBe('verified')
  })
})
