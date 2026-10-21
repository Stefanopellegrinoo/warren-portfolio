import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PortfolioResults from '../portfolios/PortfolioResults'
import { parseFields } from '../portfolios/PortfolioItemFields'
import { analyzePortfolio } from '@/lib/on-portfolio-analytics'
import { analyzeOn } from '@/lib/on-analytics'

const on = (isin: string, over: Record<string, unknown>, flows: { date: string; ren: number; amo: number }[], price: number | null) =>
  analyzeOn({
    terms: { isin, tickerO: 'TSTO', tickerD: 'TSTD', tickerC: null, issuer: 'Emisor de Prueba S.A.', description: null, law: 'NY', currency: 'USD', paymentPlaza: 'CCL', est: 'Step Up', frequency: 'Semestral', issueDate: '2026-04-22', maturityDate: '2028-04-21', couponRate: 0.06, residualPct: 100, accrualStart: '2026-10-22', issuedAmountByma: null, adtvO: null, adtvD: null, adtvC: null, asOf: '2026-10-20', ...over } as any,
    flows, overrides: [], events: [], check: null, curve: [], price, settle: '2026-10-22',
  })
const A = on('AR0000000001', { tickerO: 'AAAAO' }, [{ date: '2027-04-22', ren: 3, amo: 0 }, { date: '2028-04-21', ren: 3, amo: 100 }], 100)
const F = on('AR0000000002', { tickerO: 'FLOAO', est: 'Tasa Variable' }, [{ date: '2028-04-21', ren: 1, amo: 100 }], 100)
const view = (items: { isin: string; mode: 'usd' | 'vn'; amount: number }[]) => renderToStaticMarkup(<PortfolioResults analysis={analyzePortfolio({ items, analyses: [A, F], today: '2026-10-21' })} />)

describe('PortfolioResults', () => {
  it('empty portfolio shows the empty state and no KPIs', () => {
    const html = view([])
    expect(html).toContain('Agregá ONs')
    expect(html).not.toContain('TIR de la cartera')
  })

  it('renders KPIs, an accessible calendar table with a caption, and the labelled chart', () => {
    const html = view([{ isin: 'AR0000000001', mode: 'vn', amount: 10_000 }])
    expect(html).toContain('TIR de la cartera')
    expect(html).toContain('no es un promedio de TIRs')
    expect(html).toMatch(/<caption class="sr-only">Cobros por mes/)
    expect(html).toMatch(/role="img" aria-label="Calendario de cobros/)
    expect(html).toContain('abr 2027')
    expect(html).toContain('10.300,00') // 3% + 100% at maturity on VN 10,000, es-AR
  })

  it('lists the warning for a floating ON and still computes the rest', () => {
    const html = view([{ isin: 'AR0000000001', mode: 'vn', amount: 10_000 }, { isin: 'AR0000000002', mode: 'usd', amount: 1_000 }])
    expect(html).toContain('Avisos (1)')
    expect(html).toContain('tasa variable')
  })
})

describe('parseFields (es-AR input)', () => {
  it('parses es-AR numbers and an empty manual price', () => {
    expect(parseFields({ mode: 'usd', amount: '10.000,50', price: '' })).toEqual({ ok: true, mode: 'usd', amount: 10000.5, manualPrice: null })
    expect(parseFields({ mode: 'vn', amount: '1.000', price: '98,5' })).toEqual({ ok: true, mode: 'vn', amount: 1000, manualPrice: 98.5 })
  })
  it('rejects empty, malformed and non-positive input with a Spanish message', () => {
    expect(parseFields({ mode: 'usd', amount: '', price: '' })).toEqual({ ok: false, error: 'Ingresá un monto' })
    expect(parseFields({ mode: 'usd', amount: '1,2,3', price: '' })).toEqual({ ok: false, error: 'Formato de número inválido' })
    expect(parseFields({ mode: 'usd', amount: '0', price: '' }).ok).toBe(false)
    expect(parseFields({ mode: 'usd', amount: '5', price: 'abc' }).ok).toBe(false)
  })
})
