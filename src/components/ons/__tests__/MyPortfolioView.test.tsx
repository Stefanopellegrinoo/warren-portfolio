// odd/tasks/ux-ons-y-operaciones.md S2: Mis ONs answers "¿cuándo cobro y cuánto?" first, then what needs
// the user's action, the next payments and the user's ONs; the analysis is collapsed.
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import MyPortfolioView from '../MyPortfolioView'
import { buildMyOnPortfolio } from '@/lib/on-my-portfolio'
import { analyzeOn } from '@/lib/on-analytics'

const on = (isin: string, over: Record<string, unknown>, flows: { date: string; ren: number; amo: number }[], price: number | null) =>
  analyzeOn({
    terms: { isin, tickerO: 'TSTO', tickerD: 'TSTD', tickerC: null, issuer: 'Emisor de Prueba S.A.', description: null, law: 'ARG', currency: 'USD', paymentPlaza: 'CCL', est: 'Step Up', frequency: 'Semestral', issueDate: '2026-04-22', maturityDate: '2028-04-21', couponRate: 0.06, residualPct: 100, accrualStart: '2026-10-22', issuedAmountByma: null, adtvO: null, adtvD: null, adtvC: null, asOf: '2026-10-20', ...over } as any,
    flows, overrides: [], events: [], check: null, curve: [], price, settle: '2026-10-22',
  })
const A = on('AR0000000001', { tickerO: 'AAAAO', tickerD: 'AAAAD', issuer: 'Alfa S.A.' }, [{ date: '2027-04-22', ren: 3, amo: 0 }, { date: '2028-04-21', ren: 3, amo: 100 }], 100)
const B = on('AR0000000002', { tickerO: 'BBBBO', tickerD: 'BBBBD', issuer: 'Beta S.A.' }, [{ date: '2027-04-22', ren: 2, amo: 0 }, { date: '2027-10-22', ren: 2, amo: 100 }], 100)
const data = (holdings: { ticker: string; quantity: number }[]) => ({
  ...buildMyOnPortfolio({ holdings, analyses: [A, B], today: '2026-10-21' }), asOf: '2026-10-20', stale: false,
})
const both = data([{ ticker: 'AAAAD', quantity: 100 }, { ticker: 'BBBBD', quantity: 50 }])
const at = (html: string, text: string) => {
  const i = html.indexOf(text)
  expect(i, `"${text}" is on the page`).toBeGreaterThanOrEqual(0)
  return i
}

describe('MyPortfolioView', () => {
  it('leads with the next payment: date, amount and which ONs pay', () => {
    const html = renderToStaticMarkup(<MyPortfolioView data={both} />)
    const next = at(html, 'Próximo cobro')
    // 22/04/2027: AAAA pays 3 % of VN 10.000 = 300 and BBBB 2 % of VN 5.000 = 100.
    expect(html.slice(next, next + 600)).toMatch(/22\/04\/2027/)
    expect(html.slice(next, next + 600)).toContain('USD 400,00')
    expect(html.slice(next, next + 600)).toMatch(/AAAAD.*BBBBD/)
    expect(at(html, 'Valor de mercado')).toBeGreaterThan(next)
    expect(at(html, 'próximos 12 meses')).toBeGreaterThan(next)
  })

  it('then the next payments as a list and the user\'s ONs, each linking to its detail', () => {
    const html = renderToStaticMarkup(<MyPortfolioView data={both} />)
    expect(at(html, 'Próximos cobros')).toBeLessThan(at(html, 'Tus ONs'))
    expect(html).toContain('href="/ons/AR0000000001"')
    expect(html).toContain('href="/ons/AR0000000002"')
    expect(html).toContain('Capital')
  })

  it('keeps the calendar and the portfolio analysis in collapsed sections', () => {
    const html = renderToStaticMarkup(<MyPortfolioView data={both} />)
    for (const title of ['Calendario de cobros', 'Análisis de la cartera']) {
      const i = at(html, title)
      const open = html.lastIndexOf('<details', i)
      expect(open, title).toBeGreaterThanOrEqual(0)
      expect(html.slice(open, html.indexOf('>', open)), title).not.toContain('open')
    }
    expect(at(html, 'Análisis de la cartera')).toBeGreaterThan(at(html, 'Tus ONs'))
  })

  it('puts the payments the user still has to load right after the summary', () => {
    const missing = [{ ticker: 'AAAAD', payments: [{ date: '2026-10-15', estimate: 30 }] }]
    const html = renderToStaticMarkup(<MyPortfolioView data={both} missing={missing as any} />)
    const alert = at(html, 'Te faltan cargar pagos')
    expect(alert).toBeGreaterThan(at(html, 'Próximo cobro'))
    expect(alert).toBeLessThan(at(html, 'Próximos cobros'))
    expect(html).toContain('href="#mc-pagos"')
  })

  it('keeps the empty state and the list of tickers without terms', () => {
    const none = renderToStaticMarkup(<MyPortfolioView data={data([])} />)
    expect(none).toContain('No tenés ONs en cartera')
    const unknown = renderToStaticMarkup(<MyPortfolioView data={{ ...buildMyOnPortfolio({ holdings: [{ ticker: 'ZZZZD', quantity: 10 }], analyses: [A], today: '2026-10-21' }), asOf: null, stale: false }} />)
    expect(unknown).toContain('ZZZZD')
    expect(unknown).toContain('sin términos en el catálogo')
  })
})
