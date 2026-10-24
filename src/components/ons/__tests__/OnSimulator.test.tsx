import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import OnSimulator from '../OnSimulator'
import OnDetail from '../OnDetail'
import { analyzeOn, type OnInput, type TermsRow } from '@/lib/on-analytics'
import type { OverrideRow } from '@/lib/on-terms'

// Synthetic ON, same shape as the simulator unit tests. No real holdings.
const ISIN = 'AR0000000001'
const TODAY = '2026-10-21'
const terms = (over: Partial<TermsRow> = {}): TermsRow => ({
  isin: ISIN, tickerO: 'TSTAO', tickerD: 'TSTAD', tickerC: 'TSTAC', issuer: 'Emisor de Prueba S.A.', description: 'ON Clase A',
  law: 'NY', currency: 'USD', paymentPlaza: 'CCL', est: 'Tasa Fija', frequency: 'Semestral',
  issueDate: '2026-04-22', maturityDate: '2028-04-22', couponRate: 0.06, residualPct: 100, accrualStart: '2026-10-22',
  issuedAmountByma: null, adtvO: null, adtvD: null, adtvC: null, asOf: '2026-10-20', ...over,
})
const flows = [
  { date: '2027-04-22', ren: 3, amo: 33 },
  { date: '2027-10-22', ren: 2, amo: 33 },
  { date: '2028-04-22', ren: 1, amo: 34 },
]
const ov = (field: string, value: unknown): OverrideRow => ({ isin: ISIN, field, value, sourceUrl: 'https://example.org/p.pdf', verifiedAt: '2026-10-01' })
const build = (over: Partial<OnInput> = {}) =>
  analyzeOn({ terms: terms(), flows, overrides: [], events: [], check: null, curve: [], price: 98, settle: '2026-10-22', ...over })
const render = (a = build(), initial = {}) => renderToStaticMarkup(<OnSimulator analysis={a} today={TODAY} initial={{ mode: 'usd', amount: '10000', ...initial }} />)

describe('OnSimulator', () => {
  it('has labelled inputs for the amount kind, the amount and the manual price', () => {
    const html = render()
    expect(html).toContain('¿Cuánto cobrás?')
    expect(html).toMatch(/<label[^>]*for="sim-amount"/)
    expect(html).toContain('id="sim-amount"')
    expect(html).toMatch(/<label[^>]*for="sim-price"/)
    expect(html).toContain('Monto en dólares (USD)')
    expect(html).toContain('Valor nominal (VN)')
  })

  it('shows what is bought, the price line and the settlement date', () => {
    const html = render()
    expect(html).toContain('VN 10.204')
    expect(html).toContain('línea D')
    expect(html).toContain('22/10/2026')
    expect(html).toContain('T+1')
  })

  it('lists every payment with both dates, the totals and the profit', () => {
    const html = render()
    expect(html).toContain('22/04/2028')
    expect(html).toContain('24/04/2028') // Saturday -> Monday
    expect(html).toContain('10.819,30') // total collected
    expect(html).toContain('819,38') // profit vs cost
    expect(html).toContain('Sin impuestos ni reinversión')
    expect(html).not.toContain('exentas de Ganancias') // TAX_COPY lives once, in the detail page's Impuestos section
  })

  it('states the payment plaza and warns when the line bought does not match it (no canje)', () => {
    const html = render(build({ lines: { D: { px: 98, v: 5 } }, ccl: null }))
    expect(html).toContain('Paga en dólar cable (exterior)')
    expect(html).toContain('el canje no está incluido')
  })

  it('unknown lot rules are stated; known ones refuse an amount below the minimum', () => {
    expect(render()).toContain('lámina mínima desconocida')
    const a = build({ price: 100, overrides: [ov('min_denomination', 10_000), ov('increment', 1_000)] })
    const html = render(a, { mode: 'vn', amount: '9000' })
    expect(html).toContain('Mínimo: VN 10.000')
    expect(html).not.toContain('Total cobrado')
    expect(render(a, { mode: 'vn', amount: '10500' })).toContain('redondeó hacia abajo a VN 10.000')
  })

  it('callable ON: YTW with workout date and the early-redemption note', () => {
    const html = render(build({ price: 104, overrides: [ov('calls', [{ from: '2027-04-22', to: null, pricePct: 100 }])] }))
    expect(html).toContain('Rendimiento al peor')
    expect(html).toContain('puede ser rescatado antes')
    expect(html).toContain('22/04/2027')
  })

  it('floating-rate ON: "No simulable: tasa variable", no form output', () => {
    const html = render(build({ terms: terms({ est: 'Tasa Variable' }) }))
    expect(html).toContain('No simulable: tasa variable')
    expect(html).not.toContain('Total cobrado')
  })

  it('no price: asks for a manual price; a manual price is labelled', () => {
    expect(render(build({ price: null }))).toContain('ingresá un precio manual')
    expect(render(build({ price: null }), { manualPrice: '98' })).toContain('precio manual')
  })

  it('coupon inside the record window is shown as not collected', () => {
    const a = build({ overrides: [ov('record_offset_days', 10)] })
    const html = renderToStaticMarkup(<OnSimulator analysis={a} today="2027-04-13" initial={{ mode: 'vn', amount: '1000' }} />)
    expect(html).toContain('no cobrás el cupón')
  })

  it('amount inputs are text with decimal keyboard (locale-safe), not type=number', () => {
    const html = render()
    expect(html).not.toContain('type="number"')
    expect(html).toMatch(/id="sim-amount"[^>]*inputMode="decimal"|inputMode="decimal"[^>]*id="sim-amount"/)
  })

  it('accepts es-AR formats: comma decimal and thousands dots', () => {
    expect(render(build(), { amount: '10000,50' })).toContain('VN 10.204')
    expect(render(build(), { amount: '10.000,50' })).toContain('VN 10.204')
    expect(render(build(), { amount: '10.000' })).toContain('VN 10.204')
  })

  it('unparseable amount: explicit format error, aria-invalid, described-by, no result', () => {
    const html = render(build(), { amount: 'abc' })
    expect(html).toContain('Formato de número inválido')
    expect(html).toMatch(/aria-invalid="true"/)
    expect(html).toMatch(/aria-describedby="sim-status"/)
    expect(html).not.toContain('Total cobrado')
  })

  it('invalid manual price: error, never falls back to the market price', () => {
    for (const manualPrice of ['abc', '0', '-4']) {
      const html = render(build(), { manualPrice })
      expect(html).toMatch(/Formato de número inválido|Precio manual inválido/)
      expect(html).not.toContain('Total cobrado')
    }
    expect(render(build(), { manualPrice: '98,5' })).toContain('precio manual')
  })

  it('huge amount: refused with a clear message', () => {
    expect(render(build(), { amount: '1000000000000000' })).toContain('demasiado grande')
  })

  it('a11y: no role=alert inside a live region; one short polite summary/error line', () => {
    const html = render()
    expect(html).not.toContain('role="alert"')
    expect(html.match(/aria-live=/g)).toHaveLength(1)
    expect(html).toMatch(/id="sim-status"[^>]*aria-live="polite"|aria-live="polite"[^>]*id="sim-status"/)
    expect(html).toMatch(/Comprás VN 10\.204.*TIR 8,28%/)
  })

  it('YTW: warning only when a call is the worst case; neutral note when maturity is', () => {
    const call = render(build({ price: 104, overrides: [ov('calls', [{ from: '2027-04-22', to: null, pricePct: 100 }])] }))
    expect(call).toContain('puede ser rescatado antes')
    const mat = render(build({ price: 98, overrides: [ov('calls', [{ from: '2027-04-22', to: null, pricePct: 100 }])] }))
    expect(mat).toContain('tiene rescate anticipado; al precio actual el peor caso es el vencimiento')
    expect(mat).not.toContain('puede ser rescatado antes')
  })

  it('payments table wrapper is keyboard-focusable and labelled', () => {
    const html = render()
    expect(html).toMatch(/tabindex="0"/i)
    expect(html).toContain('aria-label="Pagos futuros')
  })

  it('without a today prop nothing is computed on the server render (client sets it after mount)', () => {
    const html = renderToStaticMarkup(<OnSimulator analysis={build()} initial={{ mode: 'usd', amount: '10000' }} />)
    expect(html).toContain('¿Cuánto cobrás?')
    expect(html).not.toContain('Total cobrado')
  })

  it('always shows the interpreted value under each input', () => {
    expect(render(build(), { amount: '10000' })).toContain('Interpretado: USD 10.000,00')
    expect(render(build(), { amount: '1.234' })).toContain('Interpretado: USD 1.234,00')
    expect(render(build(), { amount: '1,000' })).toContain('Interpretado: USD 1,00')
    expect(render(build(), { mode: 'vn', amount: '1.000' })).toContain('Interpretado: VN 1.000')
    expect(render(build(), { manualPrice: '95.5' })).toContain('Interpretado: 95,50 por 100 VN')
    expect(render(build(), { amount: 'abc' })).not.toContain('Interpretado')
    expect(render(build(), { amount: '10000' })).toMatch(/aria-describedby="sim-amount-hint"/)
  })

  it('is part of the detail page', () => {
    const html = renderToStaticMarkup(<OnDetail analysis={build()} history={[]} asOf="2026-10-20" stale={false} prices={{ ok: true, fetchedAt: '2026-10-21T15:00:00Z' }} />)
    expect(html).toContain('¿Cuánto cobrás?')
  })

  it('the own price sits behind "Usar otro precio"; it is open with a manual price or without a market price', () => {
    const closed = render()
    expect(closed).toContain('Usar otro precio')
    expect(closed).toMatch(/<div id="sim-price-box" hidden=""/)
    expect(closed).toMatch(/aria-expanded="false"[^>]*aria-controls="sim-price-box"|aria-controls="sim-price-box"[^>]*aria-expanded="false"/)
    const open = render(build(), { manualPrice: '98' })
    expect(open).toContain('Volver al precio de hoy')
    expect(open).not.toMatch(/id="sim-price-box" hidden/)
    const noPrice = render(build({ price: null }))
    expect(noPrice).not.toContain('Usar otro precio')
    expect(noPrice).not.toMatch(/id="sim-price-box" hidden/)
  })

  it('leads with what you buy, pay, collect, gain and the TIR; the calculation details are collapsed', () => {
    const html = render()
    const lead = html.slice(0, html.indexOf('<details'))
    const labels = [...lead.matchAll(/<dt[^>]*>([^<]*)<\/dt>/g)].map((m) => m[1])
    expect(labels).toEqual(['Comprás', 'Pagás', 'Cobrás en total', 'Ganancia', 'TIR (rinde por año)'])
    expect(lead).toContain('+USD 819,38')
    const details = html.slice(html.indexOf('<details'))
    expect(details).toContain('Detalle del cálculo')
    expect(details).toContain('Precio sucio usado')
    expect(details).toContain('Intereses devengados')
    expect(html).not.toMatch(/<details[^>]*open/)
  })

  it('payments: a list on phones, a table without a forced width on desktop', () => {
    const html = render()
    expect(html).toMatch(/<ul aria-label="Pagos futuros de la tenencia simulada, en dólares" class="[^"]*min-\[1281px\]:hidden"/)
    expect(html).toMatch(/aria-label="Pagos futuros de la tenencia simulada \(desplazable\)" class="[^"]*max-\[1280px\]:hidden/)
    expect(html).not.toMatch(/min-w-\[\d+px\]/)
    expect(html).toContain('USD 3.673,44</p></li>') // the list's total of the first payment: VN 10.204 × (3 + 33)%
  })

  it('explains a moved pay date and a skipped coupon in visible text, not a tooltip', () => {
    expect(render()).toContain('día hábil siguiente al 22/04/2028')
    const a = build({ overrides: [ov('record_offset_days', 10)] })
    const html = renderToStaticMarkup(<OnSimulator analysis={a} today="2027-04-13" initial={{ mode: 'vn', amount: '1000' }} />)
    expect(html).toContain('no cobrás el cupón: los USD')
    expect(html).not.toContain('title=')
  })

  it('starts at USD 1.000, or at what the minimum lot costs today when that is more, so it opens on a result', () => {
    const plain = renderToStaticMarkup(<OnSimulator analysis={build()} today={TODAY} />)
    expect(plain).toContain('value="1000"')
    const lot = renderToStaticMarkup(<OnSimulator analysis={build({ overrides: [ov('min_denomination', 10_000), ov('increment', 1_000)] })} today={TODAY} />)
    expect(lot).toContain('value="9800"') // VN 10.000 at 98
    expect(lot).toContain('Cobrás en total')
    expect(lot).not.toContain('Mínimo: VN')
  })
})
