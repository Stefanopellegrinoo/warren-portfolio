import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import AssetHeader from '../AssetHeader'
import type { AssetPage } from '@/lib/fundamentals/service'

// odd/tasks/asset-page.md S1 (T5b): the day change under the price, as in the mockup. Invented numbers.
const PAGE: AssetPage = {
  ticker: 'MELI', name: 'MercadoLibre, Inc.', exchange: 'NASDAQ', price: 1660.13, currency: 'USD', supported: true,
  listing: { ticker: 'MELI', market: 'america', tvSymbol: 'NASDAQ:MELI', yahooSymbol: 'MELI' },
  bymaListing: false, metrics: null, peers: [], sources: {}, dayChange: null,
}

function change(over: Partial<AssetPage>) {
  const el = document.createElement('div')
  el.innerHTML = renderToStaticMarkup(<AssetHeader page={{ ...PAGE, ...over }} />)
  return [...el.querySelectorAll('p')].find((p) => p.textContent!.endsWith(' hoy')) ?? null
}

describe('AssetHeader: day change', () => {
  it('a fall: minus sign, es-AR, in the down color', () => {
    const p = change({ dayChange: { abs: -36.09, pct: -0.0216 } })!
    expect(p.textContent).toBe('−36,09 (−2,16 %) hoy')
    expect(p.className).toContain('text-danger')
  })

  it("a rise: plus sign, in the up color, with the price's decimals under 1", () => {
    const p = change({ price: 0.52, dayChange: { abs: 0.0123, pct: 0.0242 } })!
    expect(p.textContent).toBe('+0,0123 (+2,42 %) hoy')
    expect(p.className).toContain('text-ok')
  })

  it('nothing when there is no day change', () => {
    expect(change({ dayChange: null })).toBeNull()
    expect(change({ dayChange: undefined })).toBeNull()
  })
})

describe('AssetHeader: a price with no known currency', () => {
  const render = (over: Partial<AssetPage>) => {
    const el = document.createElement('div')
    el.innerHTML = renderToStaticMarkup(<AssetHeader page={{ ...PAGE, ...over }} />)
    return (el.textContent ?? '').replace(/[  ]/g, ' ')
  }
  const TOYOTA = { ticker: '7203.T', name: 'Toyota Motor Corporation', exchange: 'Tokyo', price: 3070, currency: null, supported: false, listing: null }

  it('says which market the bare number is from, so it does not read as dollars', () => {
    const text = render(TOYOTA)
    expect(text).toContain('Precio en Tokyo')
    expect(text).toContain('3.070,00')
    expect(text).not.toContain('US$')
  })

  it('just says "Precio" when the market is unknown too, and nothing when the currency is known', () => {
    expect(render({ ...TOYOTA, exchange: null })).toContain('Precio')
    expect(render({})).not.toContain('Precio')
  })
})

describe('AssetHeader: market badge', () => {
  const badge = (over: Partial<AssetPage>) => {
    const el = document.createElement('div')
    el.innerHTML = renderToStaticMarkup(<AssetHeader page={{ ...PAGE, ...over }} />)
    return el.querySelector('h1 + span')?.textContent ?? null
  }

  it("shows the asked listing's exchange, and BCBA as BYMA, the name people know", () => {
    expect(badge({})).toBe('NASDAQ')
    expect(badge({ ticker: 'BCBA:YPFD', exchange: 'BCBA' })).toBe('BYMA')
  })

  it("keeps an ADR's own market though its numbers come from BYMA", () => {
    const listing = { ticker: 'BCBA:GGAL', market: 'argentina' as const, tvSymbol: 'BCBA:GGAL', yahooSymbol: 'GGAL.BA' }
    expect(badge({ ticker: 'GGAL', exchange: 'NASDAQ', bymaListing: true, listing })).toBe('NASDAQ')
  })

  it('shows a market outside TradingView as the page names it, and none when unknown', () => {
    expect(badge({ exchange: 'Tokyo', listing: null, supported: false })).toBe('Tokyo')
    expect(badge({ exchange: null, listing: null, supported: false })).toBeNull()
  })
})

describe('AssetHeader: a coin (T10)', () => {
  const BTC = { ticker: 'BTC-USD', name: 'Bitcoin USD', exchange: 'CCC', price: 77319.46, currency: 'USD', supported: false, listing: null, kind: 'crypto' as const }

  it("badges it Cripto, not Yahoo's feed name, and opens the chart on the app's Binance pair", () => {
    const el = document.createElement('div')
    el.innerHTML = renderToStaticMarkup(<AssetHeader page={{ ...PAGE, ...BTC }} />)
    expect(el.querySelector('h1 + span')?.textContent).toBe('Cripto')
    expect(el.querySelector('a')!.getAttribute('href')).toBe('/trading?symbol=BTCUSDT')
    expect(el.textContent!.replace(/[\u00a0\u202f]/g, ' ')).toContain('US$ 77.319,46')
  })
})
