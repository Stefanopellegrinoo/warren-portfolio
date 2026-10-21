import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import OnDetail from '../OnDetail'
import OnNotFound from '../OnNotFound'
import { analyzeOn, type OnInput, type TermsRow } from '@/lib/on-analytics'
import type { OverrideRow } from '@/lib/on-terms'

// Synthetic amortizing ON (100 -> 67 -> 34 -> 0), NY law. Public-style terms, no real holdings.
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
  paymentPlaza: 'CCL',
  est: 'Tasa Fija',
  frequency: 'Semestral',
  issueDate: '2026-04-22',
  maturityDate: '2028-04-22',
  couponRate: 0.06,
  residualPct: 100,
  accrualStart: '2026-10-22',
  issuedAmountByma: 50_000_000,
  adtvO: 1000,
  adtvD: 500,
  adtvC: null,
  asOf: '2026-10-20',
  ...over,
})
// 2027-05-22 is a Saturday: the adjusted pay date moves to Monday 24.
const flows = [
  { date: '2027-04-22', ren: 3, amo: 33 },
  { date: '2027-05-22', ren: 2, amo: 33 },
  { date: '2028-04-22', ren: 1, amo: 34 },
]
const ov = (field: string, value: unknown, verifiedAt: string | null = '2026-10-01'): OverrideRow => ({ isin: 'AR0000000001', field, value, sourceUrl: 'https://example.org/p.pdf', verifiedAt })
const build = (over: Partial<OnInput> = {}) =>
  analyzeOn({ terms: terms(), flows, overrides: [], events: [], check: null, curve: [], price: 98, settle: SETTLE, ...over })
const history = [
  { date: '2026-10-19', close: 97.5 },
  { date: '2026-10-20', close: 98 },
]
const render = (a = build(), h = history, extra = {}) =>
  renderToStaticMarkup(<OnDetail analysis={a} history={h} asOf="2026-10-20" stale={false} prices={{ ok: true, fetchedAt: '2026-10-21T15:00:00Z' }} {...extra} />)

describe('OnDetail: schedule', () => {
  it('amortizing ON: residual 100 -> 67 -> 34 with coupons on the residual', () => {
    const a = build()
    expect(a.detail.schedule.map((s) => s.residualBeforePct)).toEqual([100, 67, 34])
    const html = render(a)
    expect(html).toContain('Cronograma de pagos')
    expect(html).toContain('100,00%')
    expect(html).toContain('67,00%')
    expect(html).toContain('34,00%')
  })

  it('shows both the contractual date and the business-day adjusted pay date', () => {
    const html = render()
    expect(html).toContain('22/05/2027')
    expect(html).toContain('24/05/2027') // Saturday -> Monday
    expect(html).toContain('día hábil')
  })

  it('floating-rate ON: no simulable, coupons shown as dashes', () => {
    const html = render(build({ terms: terms({ est: 'Tasa Variable' }) }))
    expect(html).toContain('No simulable')
    expect(html).toContain('Tasa variable')
  })
})

describe('OnDetail: terms, provenance and copy', () => {
  it('payment plaza copy does not depend on the line bought', () => {
    expect(render()).toContain('Paga en dólar cable (exterior)')
    expect(render(build({ terms: terms({ paymentPlaza: null }) }))).toContain('Plaza de pago: sin dato')
  })

  it('day count default renders "sin verificar"; a verified override renders its date and link', () => {
    expect(render()).toContain('sin verificar')
    const html = render(build({ overrides: [ov('day_count', 'ACT/365')] }))
    expect(html).toContain('ACT/365')
    expect(html).toContain('verificado 01/10/2026')
    expect(html).toContain('href="https://example.org/p.pdf"')
  })

  it('unknown lot rules say "lámina mínima desconocida"; known ones show the values', () => {
    expect(render()).toContain('lámina mínima desconocida')
    const html = render(build({ overrides: [ov('min_denomination', 10000), ov('increment', 1000, null)] }))
    expect(html).toContain('VN 10.000')
    expect(html).not.toContain('lámina mínima desconocida')
  })

  it('issued amount: override wins, BYMA value only as outdated-possible text', () => {
    const html = render(build({ terms: terms({ issuedAmountByma: 313_462_519 }), overrides: [ov('issued_amount', 213_462_519)] }))
    expect(html).toContain('VN 213.462.519')
    expect(html).toContain('según BYMA, puede estar desactualizado')
    expect(html).toContain('313.462.519')
    const noOverride = render(build({ terms: terms({ issuedAmountByma: 70_000_000 }) }))
    expect(noOverride).toContain('70.000.000')
    expect(noOverride).toContain('según BYMA, puede estar desactualizado')
  })

  it('tax copy is informational and no net-of-tax figure appears', () => {
    const html = render()
    expect(html).toContain('exentas de Ganancias')
    expect(html).toContain('art. 36 Ley 23.576')
    expect(html).toContain('consultá a tu contador')
    expect(html).not.toMatch(/neto de impuestos|TIR neta/i)
  })

  it('corporate events show with date and source', () => {
    const html = render(build({ events: [{ kind: 'reapertura', eventDate: '2026-09-01', note: 'Reapertura de la clase', sourceUrl: 'https://example.org/e', verifiedAt: null }] }))
    expect(html).toContain('Reapertura')
    expect(html).toContain('01/09/2026')
    expect(html).toContain('href="https://example.org/e"')
  })
})

describe('OnDetail: options and yield block', () => {
  it('shows calls and the yield-to-worst workout when a call is in the money', () => {
    const a = build({ price: 104, overrides: [ov('calls', [{ from: '2027-04-22', to: null, pricePct: 100 }])] })
    expect(a.detail.ytw?.kind).toBe('call')
    const html = render(a)
    expect(html).toContain('Rendimiento al peor')
    expect(html).toContain('rescate')
    expect(html).toContain('100,00%')
  })

  it('no options registered says so, and a change-of-control put is text only', () => {
    expect(render()).toContain('Sin opciones de rescate registradas')
    const html = render(build({ overrides: [ov('puts', [{ kind: 'change_of_control', pricePct: 101 }])] }))
    expect(html).toContain('cambio de control')
    expect(html).toContain('101,00%')
  })
})

describe('OnDetail: price-based fields and checks', () => {
  it('shows analytics with their sources when priced', () => {
    const html = render()
    expect(html).toContain('Warren (cálculo propio)')
    expect(html).toContain('data912')
    expect(html).toContain('Precio limpio')
    expect(html).toContain('Intereses devengados')
    expect(html).toContain('Duración modificada')
    expect(html).toContain('Convexidad')
  })

  it('no price: terms and schedule still shown, analytics as dashes with "Sin precio"', () => {
    const html = render(build({ price: null }))
    expect(html).toContain('Sin precio')
    expect(html).toContain('Cronograma de pagos')
    expect(html).toContain('24/05/2027')
  })

  it('method flag shows both values; a terms note is informational', () => {
    const check = { asOf: '2026-10-20', bymaYtmPct: 6.0, methodYtmPct: 6.15, methodDiffBp: 15, termsYtmPct: 6.0, termsDiffBp: 0, flagged: true }
    const flagged = render(build({ check }))
    expect(flagged).toContain('Cálculo no verificado')
    expect(flagged).toContain('difiere de BYMA')
    expect(flagged).toContain('6,15%')
    const note = render(build({ check: { ...check, flagged: false, methodDiffBp: 0.2, termsDiffBp: 6, termsYtmPct: 6.06 } }))
    expect(note).toContain('difiere de BYMA por convención')
    expect(note).not.toContain('Cálculo no verificado')
  })

  it('shows the price chart section, or says there is no history yet', () => {
    expect(render()).toContain('Historial de precio')
    expect(render(build(), [])).toContain('Todavía no hay historial')
  })
})

describe('OnNotFound', () => {
  it('is a Spanish 404 with a way back', () => {
    const html = renderToStaticMarkup(<OnNotFound />)
    expect(html).toContain('ON no encontrada')
    expect(html).toContain('href="/ons"')
  })
})

describe('OnDetail: BYMA yield and price quality', () => {
  it('shows both yields side by side with the one-line explanation', () => {
    const check = { asOf: '2026-10-20', bymaYtmPct: 8.41, methodYtmPct: 8.41, methodDiffBp: 0, termsYtmPct: 8.41, termsDiffBp: 0, flagged: false }
    const html = render(build({ check }))
    expect(html).toContain('TIR Warren (precio en dólares, línea D)')
    expect(html).toContain('TIR BYMA (precio en pesos ÷ MEP)')
    expect(html).toContain('8,41%')
    expect(html).toContain('20/10/2026')
    expect(html).toContain('pueden diferir porque parten de precios distintos')
  })

  it('no BYMA yield: no comparison tile', () => {
    expect(render()).not.toContain('TIR BYMA')
  })

  it('no trades today: explains that the D price is only a reference', () => {
    const html = render(build({ noTrades: true }))
    expect(html).toContain('precio de referencia sin operaciones en la línea D')
    expect(render()).not.toContain('sin operaciones en la línea D')
  })
})

describe('OnDetail: quiet market', () => {
  it('shows one banner instead of per-row claims', () => {
    const html = render(build(), history, { prices: { ok: true, quiet: true, fetchedAt: null } })
    expect(html).toContain('Mercado sin operaciones aún hoy')
    expect(render()).not.toContain('Mercado sin operaciones aún hoy')
  })
})
