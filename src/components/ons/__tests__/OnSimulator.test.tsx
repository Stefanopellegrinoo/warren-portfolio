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
    expect(html).toContain('Simulador de pagos')
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
    expect(html).toContain('exentas de Ganancias')
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

  it('is part of the detail page', () => {
    const html = renderToStaticMarkup(<OnDetail analysis={build()} history={[]} asOf="2026-10-20" stale={false} prices={{ ok: true, fetchedAt: '2026-10-21T15:00:00Z' }} />)
    expect(html).toContain('Simulador de pagos')
  })
})
