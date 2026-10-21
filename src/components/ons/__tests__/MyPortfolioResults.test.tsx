import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PortfolioResults from '../portfolios/PortfolioResults'
import MyPortfolioView from '../MyPortfolioView'
import { buildMyOnPortfolio } from '@/lib/on-my-portfolio'
import { analyzeOn } from '@/lib/on-analytics'

const on = (isin: string, over: Record<string, unknown>, flows: { date: string; ren: number; amo: number }[], price: number | null) =>
  analyzeOn({
    terms: { isin, tickerO: 'TSTO', tickerD: 'TSTD', tickerC: null, issuer: 'Emisor de Prueba S.A.', description: null, law: 'ARG', currency: 'USD', paymentPlaza: 'CCL', est: 'Step Up', frequency: 'Semestral', issueDate: '2026-04-22', maturityDate: '2028-04-21', couponRate: 0.06, residualPct: 100, accrualStart: '2026-10-22', issuedAmountByma: null, adtvO: null, adtvD: null, adtvC: null, asOf: '2026-10-20', ...over } as any,
    flows, overrides: [], events: [], check: null, curve: [], price, settle: '2026-10-22',
  })
const A = on('AR0000000001', { tickerO: 'AAAAO', tickerD: 'AAAAD' }, [{ date: '2027-04-22', ren: 3, amo: 0 }, { date: '2028-04-21', ren: 3, amo: 100 }], 100)
const mine = (holdings: { ticker: string; quantity: number }[]) => buildMyOnPortfolio({ holdings, analyses: [A], today: '2026-10-21' })

describe('PortfolioResults (held mode)', () => {
  it('labels market value, hides the purchase profit and shows the next payment per ON', () => {
    const html = renderToStaticMarkup(<PortfolioResults held analysis={mine([{ ticker: 'AAAAD', quantity: 100 }]).analysis} />)
    expect(html).toContain('Valor de mercado')
    expect(html).not.toContain('Ganancia vs. costo')
    expect(html).toContain('Próximo cobro')
    expect(html).toContain('22/04/2027')
    expect(html).toContain('300,00')
    expect(html).toContain('Intereses próximos 12 meses')
  })
})

describe('MyPortfolioView', () => {
  it('lists tickers without terms and an empty state when nothing is held', () => {
    const m = mine([{ ticker: 'ZZZZD', quantity: 10 }])
    const html = renderToStaticMarkup(<MyPortfolioView data={{ ...m, asOf: '2026-10-20', stale: false }} />)
    expect(html).toContain('sin términos en el catálogo')
    expect(html).toContain('ZZZZD')
    const none = renderToStaticMarkup(<MyPortfolioView data={{ ...mine([]), asOf: null, stale: false }} />)
    expect(none).toContain('No tenés ONs en cartera')
  })
})
