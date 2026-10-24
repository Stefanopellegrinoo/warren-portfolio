import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import OnDetail from '../OnDetail'
import OnNotFound from '../OnNotFound'
import { analyzeOn, type OnInput, type TermsRow } from '@/lib/on-analytics'
import type { OverrideRow } from '@/lib/on-terms'
import { TAX_COPY } from '@/lib/on-format'

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

describe('OnDetail: price line', () => {
  it('shows the line used next to the price', () => {
    expect(render(build({ terms: terms({ paymentPlaza: 'CCL' }), price: null, lines: { D: { px: 100, v: 5 }, C: { px: 96, v: 5 } } }))).toContain('línea C · cable')
    expect(render()).toContain('línea D · MEP')
  })

  it('explains the fallback to the other dollar line', () => {
    const html = render(build({ terms: terms({ paymentPlaza: 'CCL' }), price: null, lines: { D: { px: 100, v: 5 } } }))
    expect(html).toContain('precio de la línea D; esta ON paga en dólar cable')
    expect(html).toContain('la TIR no incluye el canje')
    const mep = render(build({ terms: terms({ paymentPlaza: 'MEP' }), price: null, lines: { C: { px: 96, v: 5 } } }))
    expect(mep).toContain('precio de la línea C; esta ON paga en dólar MEP')
  })
})

describe('OnDetail: implied cable price', () => {
  it('explains the method with the CCL value and its as-of', () => {
    const a = build({ terms: terms({ paymentPlaza: 'CCL' }), price: null, lines: { D: { px: 100, v: 5 }, O: { px: 96000, v: 5 } }, ccl: { rate: 1000, at: '2026-10-21T15:00:00Z' } })
    const html = render(a)
    expect(html).toContain('implícito · línea O ÷ CCL ($1.000,00)')
    expect(html).toContain('Precio implícito: línea O (pesos) ÷ CCL')
    expect(html).toContain('21/10/2026')
    expect(html).not.toContain('GGAL')
  })
})

describe('OnDetail: no-trades text names the line used', () => {
  it('names C, O or D', () => {
    const c = render(build({ terms: terms({ paymentPlaza: 'CCL' }), price: null, lines: { C: { px: 96, v: 0 } }, quiet: false }))
    expect(c).toContain('sin operaciones en la línea C')
    const o = render(build({ terms: terms({ paymentPlaza: 'CCL' }), price: null, lines: { O: { px: 96000, v: 0 } }, ccl: { rate: 1000, at: '2026-10-21T15:00:00Z' }, quiet: false }))
    expect(o).toContain('sin operaciones en la línea O')
  })
})

// odd/tasks/ux-ons-y-operaciones.md S3 and S6: the page answers "¿qué es, cuánto rinde, cuándo paga?" first.
describe('OnDetail: what comes first (S3)', () => {
  const page = (a = build(), extra = {}) => render(a, history, { today: '2026-10-21', ...extra })
  const facts = (html: string) => html.slice(html.indexOf('aria-label="Lo principal"'), html.indexOf('</section>', html.indexOf('aria-label="Lo principal"')))
  const labels = (html: string) => [...html.matchAll(/<dt[^>]*>([^<]*)<\/dt>/g)].map((m) => m[1])

  it('shows at most five facts, in order, with one TIR and no source line under each', () => {
    const top = facts(page())
    expect(labels(top)).toEqual(['Precio', 'TIR (rinde por año)', 'Vencimiento', 'Próximo pago', 'Lámina mínima'])
    expect(top).toContain('98,00')
    expect(top).not.toContain('BYMA')
    expect(top).not.toContain('Warren (cálculo propio)')
  })

  it('maturity says how long is left; the next payment says what it pays; the lot says what it costs', () => {
    const top = facts(page(build({ overrides: [ov('min_denomination', 10000)] })))
    expect(top).toContain('22/04/2028')
    expect(top).toContain('en 1 año y 6 meses')
    expect(top).toContain('22/04/2027')
    expect(top).toContain('Paga 3,00% de interés y devuelve el 33,00% del capital')
    expect(top).toContain('VN 10.000')
    expect(top).toContain('Unos USD 9.800 al precio de hoy')
  })

  it('no price: one plain sentence instead of price and TIR, and no technical section', () => {
    const html = page(build({ price: null }))
    const top = facts(html)
    expect(top).toContain('Sin precio en dólares hoy: no se puede calcular cuánto rinde')
    expect(labels(top)).toEqual(['Precio y TIR', 'Vencimiento', 'Próximo pago', 'Lámina mínima'])
    expect(html).not.toContain('Datos técnicos')
  })

  it('the simulator comes right after the facts, before the chart', () => {
    const html = page()
    const factsEnd = html.indexOf('</section>', html.indexOf('aria-label="Lo principal"')) + '</section>'.length
    expect(html.slice(factsEnd)).toMatch(/^<section class="min-w-0" aria-labelledby="sim-title">/)
    expect(html.indexOf('¿Cuánto cobrás?')).toBeLessThan(html.indexOf('Historial de precio'))
    expect(html).toContain('Comprás') // the given date lets the simulator compute
  })

  it('technical data, schedule, terms, options, taxes, sources and glossary are collapsed, in that order', () => {
    const html = page(build({ overrides: [ov('calls', [{ from: '2027-04-22', to: null, pricePct: 100 }])] }))
    const titles = [...html.matchAll(/<details[^>]*>\s*<summary[^>]*><span[^>]*><h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1])
    expect(titles).toEqual([
      'Detalle del cálculo', 'Datos técnicos', 'Cronograma de pagos (% del valor nominal)', 'Condiciones de emisión',
      'Opciones de rescate y venta', 'Impuestos', 'Fuentes de los datos', '¿Qué significa cada dato?',
    ])
    expect(html).not.toMatch(/<details[^>]*open/)
    const technical = html.slice(html.indexOf('id="on-technical"'), html.indexOf('id="on-schedule"'))
    expect(technical).toContain('TIR Warren')
    expect(technical).toContain('Duración Macaulay')
    expect(technical).toContain('Paridad')
  })

  it('the BYMA TIR appears only inside the technical data', () => {
    const check = { asOf: '2026-10-20', bymaYtmPct: 8.41, methodYtmPct: 8.41, methodDiffBp: 0, termsYtmPct: 8.41, termsDiffBp: 0, flagged: false }
    const html = page(build({ check }))
    expect(html.split('TIR BYMA').length - 1).toBe(1)
    expect(html.indexOf('TIR BYMA')).toBeGreaterThan(html.indexOf('id="on-technical"'))
    expect(html.indexOf('TIR BYMA')).toBeLessThan(html.indexOf('id="on-schedule"'))
  })

  it('shows the tax copy exactly once in the whole page', () => {
    expect(page().split(TAX_COPY).length - 1).toBe(1)
  })

  it('no explanation lives only in a tooltip: the only titles are the source chips, explained in visible text', () => {
    const html = page(build({ events: [{ kind: 'reapertura', eventDate: '2026-09-01', note: 'Reapertura de la clase', sourceUrl: 'https://example.org/e', verifiedAt: null }] }))
    const titles = [...html.matchAll(/title="([^"]*)"/g)].map((m) => m[1])
    expect(titles.length).toBeGreaterThan(0)
    for (const t of titles) expect(t).toMatch(/^(Verificado contra|Dato de BYMA Educa|Fuente secundaria|Valor por defecto)/)
    expect(html).toContain('Cada dato dice de dónde sale')
    expect(html).toContain('Reapertura 01/09/2026: Reapertura de la clase') // the event note, once visible
  })

  it('ends with the glossary of the terms the page shows', () => {
    const html = page()
    expect(html).toContain('¿Qué significa cada dato?')
    expect(html).toContain('Precio sucio y limpio')
    expect(html).toContain('Lámina mínima')
    expect(html).not.toMatch(/<dt[^>]*>YTW<\/dt>/) // no callable terms, no YTW entry
  })
})
