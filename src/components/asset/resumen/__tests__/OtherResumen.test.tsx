import { describe, it, expect, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import type { AssetPage, AssetProfile } from '@/lib/fundamentals/service'
import { CryptoResumen, FundResumen } from '../OtherResumen'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// odd/tasks/asset-page.md T10, S1: an ETF's and a coin's Resumen. Public names; invented numbers.
const BASE: AssetProfile = {
  sector: null, industry: null, country: null, fullTimeEmployees: null, currency: 'USD', fiftyTwoWeekLow: 600, fiftyTwoWeekHigh: 800,
  targetMeanPrice: null, numberOfAnalystOpinions: null, nextEarningsDate: null, earnings: [],
}
const FUND = {
  category: 'Large Blend', family: 'State Street', inceptionDate: '1993-01-22', expenseRatio: 0.000945, totalAssets: 809216114688,
  yield: 0.0099, ytdReturn: 0.1414, threeYearReturn: 0.2493, fiveYearReturn: -0.0575, holdings: [], sectors: [],
}
const page = (over: Partial<AssetPage>): AssetPage => ({
  ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust', exchange: 'AMEX', price: 700, currency: 'USD', supported: true, kind: 'etf',
  listing: null, bymaListing: false, metrics: null, peers: [], sources: {}, profile: { ...BASE, kind: 'etf', fund: FUND }, ...over,
})
const BTC = page({
  ticker: 'BTC-USD', name: 'Bitcoin USD', kind: 'crypto', supported: false, price: 77319.46,
  profile: {
    ...BASE, kind: 'crypto', fiftyTwoWeekLow: 57747.77, fiftyTwoWeekHigh: 111167.31, regularMarketPrice: 77319.46, marketCap: 1555248578560,
    dayChange: { abs: -3853.57, pct: -0.0475 }, circulatingSupply: 20105364, volume24h: 59247714304, fund: null,
  },
})

afterEach(() => { document.body.innerHTML = '' })

async function mount(node: React.ReactNode) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  await act(async () => createRoot(el).render(node))
  return el
}
const text = (node: Element | null | undefined) => (node?.textContent ?? '').replace(/\s+/g, ' ')
const card = (el: Element, title: string) => [...el.querySelectorAll('section')].find((s) => text(s.querySelector('h3')) === title)
const row = (el: Element | undefined, label: string) => [...(el?.querySelectorAll('dl > div') ?? [])].find((r) => text(r.querySelector('dt')).startsWith(label))
const ADVICE = /compr|recomend|vendé|vender|\bventa\b|conviene|oportunidad/i

describe('FundResumen', () => {
  it('says what the fund returned, with its sign, as fractions turned into es-AR percents', async () => {
    const el = await mount(<FundResumen page={page({})} />)
    const returns = card(el, 'Cuánto rindió')
    expect(text(row(returns, 'En lo que va del año'))).toContain('+14,1 %')
    expect(text(row(returns, 'Por año, últimos 3 años'))).toContain('+24,9 %')
    expect(text(row(returns, 'Por año, últimos 5 años'))).toContain('−5,8 %')
    expect(text(returns)).toContain('Lo que rindió no dice lo que va a rendir.')
  })

  it('shows its costs and size, each with what it means, and who runs it since when', async () => {
    const el = await mount(<FundResumen page={page({})} />)
    const costs = card(el, 'Costos y tamaño')
    expect(text(row(costs, 'Gastos por año'))).toContain('0,09 %')
    expect(text(row(costs, 'Gastos por año'))).toContain('Lo que el fondo descuenta cada año de lo invertido')
    expect(text(row(costs, 'Rendimiento por dividendos'))).toContain('0,99 %')
    expect(text(row(costs, 'Activos del fondo'))).toContain('US$ 809.216 M')
    const fund = card(el, 'El fondo')
    expect(text(row(fund, 'Categoría'))).toContain('Large Blend')
    expect(row(fund, 'Categoría')!.querySelector('dd')!.getAttribute('lang')).toBe('en')
    expect(text(row(fund, 'Administradora'))).toContain('State Street')
    expect(text(row(fund, 'Desde'))).toContain('22 de enero de 1993')
    expect(card(el, 'Últimas 52 semanas')).toBeDefined()
    expect(text(el)).not.toMatch(ADVICE)
  })

  it('says when Yahoo could not describe the fund', async () => {
    const el = await mount(<FundResumen page={page({ profile: null })} />)
    expect(text(el)).toContain('No pudimos traer los datos del fondo. Probá de nuevo en un rato.')
  })
})

describe('CryptoResumen', () => {
  it("shows the coin's market: price, the day's change, market cap, coins in circulation, 24 h volume and 52 weeks", async () => {
    const el = await mount(<CryptoResumen page={BTC} />)
    const market = card(el, 'Mercado')
    expect(text(row(market, 'Precio'))).toContain('US$ 77.319,46')
    expect(text(row(market, 'Cambio del día'))).toContain('−4,75 % (−3.853,57)')
    // Yahoo's crypto day starts at 0 h UTC: say so.
    expect(text(row(market, 'Cambio del día'))).toContain('Desde las 21 h de Argentina')
    expect(text(row(market, 'Capitalización'))).toContain('US$ 1.555.249 M')
    expect(text(row(market, 'En circulación'))).toContain('20,1 M BTC')
    expect(text(row(market, 'Volumen en 24 horas'))).toContain('US$ 59.248 M')
    const range = card(el, 'Últimas 52 semanas')
    expect(text(range)).toContain('US$ 57.748')
    expect(text(range)).toContain('US$ 111.167')
    expect(text(el)).not.toMatch(ADVICE)
  })

  it('leaves out what Yahoo did not send, and says when it sent nothing', async () => {
    const bare = await mount(<CryptoResumen page={{ ...BTC, profile: { ...BTC.profile!, circulatingSupply: null, dayChange: null } }} />)
    expect(row(card(bare, 'Mercado'), 'En circulación')).toBeUndefined()
    expect(row(card(bare, 'Mercado'), 'Cambio del día')).toBeUndefined()

    const none = await mount(<CryptoResumen page={{ ...BTC, profile: null }} />)
    expect(text(none)).toContain('No pudimos traer los datos de esta criptomoneda. Probá de nuevo en un rato.')
  })
})
