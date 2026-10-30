import { describe, it, expect, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import type { AssetPage } from '@/lib/fundamentals/service'
import type { YahooFund } from '@/lib/fundamentals/yahoo'
import { ComposicionTab } from '../ComposicionTab'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// odd/tasks/asset-page.md T10, S1: an ETF's holdings and sectors. Public names; invented weights.
const FUND: YahooFund = {
  category: null, family: null, inceptionDate: null, expenseRatio: null, totalAssets: null, yield: null, ytdReturn: null,
  threeYearReturn: null, fiveYearReturn: null,
  holdings: [
    { symbol: 'NVDA', name: 'NVIDIA Corp', weight: 0.0836 },
    { symbol: '2330.TW', name: 'Taiwan Semiconductor Manufacturing Co Ltd', weight: 0.05 },
    { symbol: '005935', name: 'Samsung Electronics Co Ltd Participating Preferred', weight: 0.0094 },
    { symbol: null, name: 'Cash', weight: 0.0026 },
  ],
  sectors: [{ sector: 'Technology', weight: 0.4045 }, { sector: 'Real Estate', weight: 0.017 }],
}
const page = (fund: YahooFund | null): AssetPage => ({
  ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust', exchange: 'AMEX', price: 700, currency: 'USD', supported: true, kind: 'etf',
  listing: null, bymaListing: false, metrics: null, peers: [], sources: {},
  profile: fund && {
    sector: null, industry: null, country: null, fullTimeEmployees: null, currency: 'USD', fiftyTwoWeekLow: null, fiftyTwoWeekHigh: null,
    targetMeanPrice: null, numberOfAnalystOpinions: null, nextEarningsDate: null, earnings: [], kind: 'etf', fund,
  },
})

afterEach(() => { document.body.innerHTML = '' })

async function mount(p: AssetPage) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  await act(async () => createRoot(el).render(<ComposicionTab page={p} />))
  return el
}
const text = (node: Element | null | undefined) => (node?.textContent ?? '').replace(/\s+/g, ' ')
const card = (el: Element, title: string) => [...el.querySelectorAll('section')].find((s) => text(s.querySelector('h3')) === title)

describe('ComposicionTab', () => {
  it('lists the largest holdings with their weight; a company with a symbol opens its own page', async () => {
    const el = await mount(page(FUND))
    const holdings = card(el, 'Principales tenencias')!
    const rows = [...holdings.querySelectorAll('li')]
    expect(rows.map((r) => text(r))).toEqual([
      'NVIDIA Corp NVDA 8,4 %',
      'Taiwan Semiconductor Manufacturing Co Ltd 2330.TW 5,0 %',
      'Samsung Electronics Co Ltd Participating Preferred 005935 0,9 %',
      'Cash 0,3 %',
    ])
    expect(rows[0].querySelector('a')!.getAttribute('href')).toBe('/activo/NVDA')
    expect(rows[1].querySelector('a')!.getAttribute('href')).toBe('/activo/2330.TW')
    // A bare number names no listing; cash names none at all.
    expect(rows[2].querySelector('a')).toBeNull()
    expect(rows[3].querySelector('a')).toBeNull()
    expect(text(holdings)).toContain('Las 4 más grandes suman 14,6 % del fondo.')
  })

  it('shows each sector in Spanish with its weight and a bar, the largest first', async () => {
    const el = await mount(page(FUND))
    const sectors = card(el, 'Por sector')!
    expect([...sectors.querySelectorAll('li')].map((r) => text(r))).toEqual(['Tecnología 40,5 %', 'Inmobiliario 1,7 %'])
    const bars = [...sectors.querySelectorAll<HTMLElement>('[data-bar]')].map((b) => b.style.width)
    expect(bars).toEqual(['100%', '4%'])
    expect(text(el)).not.toMatch(/compr|recomend|vendé|vender|\bventa\b|conviene|oportunidad/i)
  })

  it('says when the fund publishes no composition, and when Yahoo did not answer', async () => {
    expect(text(await mount(page({ ...FUND, holdings: [], sectors: [] })))).toContain('No tenemos la composición de este fondo.')
    expect(text(await mount(page(null)))).toContain('No pudimos traer la composición del fondo. Probá de nuevo en un rato.')
  })
})
