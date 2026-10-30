import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import AssetHeader from '../AssetHeader'
import type { AssetPage } from '@/lib/fundamentals/service'

// odd/tasks/asset-page.md S1 (T5b): the day change under the price, as in the mockup. Invented numbers.
const PAGE: AssetPage = {
  ticker: 'MELI', name: 'MercadoLibre, Inc.', exchange: 'NasdaqGS', price: 1660.13, currency: 'USD', supported: true,
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
