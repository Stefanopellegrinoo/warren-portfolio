import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { forgetCached } from '@/lib/client-cache'
import type { AssetPage } from '@/lib/fundamentals/service'
import type { Metrics } from '@/lib/fundamentals/metrics'

// odd/tasks/asset-page.md S1: the page shell. Números is T6's; here it only has to appear.
vi.mock('@/components/asset/numeros/NumerosTab', () => ({ NumerosTab: () => <p>Pestaña Números</p> }))

import AssetView, { AssetTabs } from '../AssetView'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { vi.unstubAllGlobals(); forgetCached(); document.body.innerHTML = '' })

const withNumbers = { pe: { id: 'pe', today: 45.2, history: { quarterly: [], ttm: [], annual: [] }, since: null, source: 'tradingview' } } as unknown as Metrics
const onlySnapshot = { beta: { id: 'beta', today: 1.1, history: { quarterly: [], ttm: [], annual: [] }, since: null, source: 'snapshot' } } as unknown as Metrics

const PAGE: AssetPage = {
  ticker: 'MELI', name: 'MercadoLibre, Inc.', exchange: 'NASDAQ', price: 1660.13, currency: 'USD', supported: true,
  listing: { ticker: 'MELI', market: 'america', tvSymbol: 'NASDAQ:MELI', yahooSymbol: 'MELI' },
  bymaListing: false, metrics: withNumbers, peers: [], sources: { tradingview: 'ok', yahoo: 'ok' },
}

async function show(answer: Response | (() => Response), ticker = 'MELI', vs?: string) {
  const urls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url)
    return typeof answer === 'function' ? answer() : answer.clone()
  }))
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<AssetView ticker={ticker} vs={vs} />) })
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  return { el, urls, text: () => el.textContent ?? '', unmount: () => act(() => root.unmount()) }
}

describe('AssetView', () => {
  it('shows the header: ticker, exchange, name and the price in its currency, es-AR', async () => {
    const { el, text, unmount } = await show(Response.json(PAGE))
    expect(el.querySelector('h1')!.textContent).toBe('MELI')
    expect(text()).toContain('NASDAQ')
    expect(text()).toContain('MercadoLibre, Inc.')
    expect(text()).toContain('US$ 1.660,13')
    expect(el.querySelector('a[href="/trading?symbol=MELI"]')!.textContent).toContain('Ver gráfico')
    expect(text()).not.toContain('en BYMA')
    unmount()
  })

  it('says when the numbers come from the BYMA listing', async () => {
    const page = { ...PAGE, ticker: 'GGAL', name: 'Grupo Financiero Galicia', bymaListing: true }
    const { text, unmount } = await show(Response.json(page), 'GGAL')
    expect(text()).toContain('Datos de Grupo Financiero Galicia en BYMA')
    unmount()
  })

  it('with only Números, shows its content and no tab bar', async () => {
    const { el, text, unmount } = await show(Response.json(PAGE))
    expect(text()).toContain('Pestaña Números')
    expect(el.querySelector('[role="tablist"]')).toBeNull()
    unmount()
  })

  it('a market without fundamentals shows name and price, and says so', async () => {
    const page = { ...PAGE, ticker: '7203.T', name: 'Toyota Motor Corporation', exchange: 'Tokyo', price: 2900, currency: null, supported: false, listing: null, metrics: null, sources: {} }
    const { text, unmount } = await show(Response.json(page), '7203.T')
    expect(text()).toContain('Toyota Motor Corporation')
    expect(text()).toContain('2.900,00')
    expect(text()).toContain('Todavía no tenemos datos financieros de este mercado')
    expect(text()).not.toContain('Pestaña Números')
    unmount()
  })

  it('an asset without statements (an ETF today) says so', async () => {
    const page = { ...PAGE, ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust', metrics: onlySnapshot, sources: { tradingview: 'ok', yahoo: 'error' } } as AssetPage
    const { text, unmount } = await show(Response.json(page), 'SPY')
    expect(text()).toContain('Todavía no tenemos datos financieros de este activo')
    expect(text()).not.toContain('Pestaña Números')
    unmount()
  })

  it('an unknown ticker shows the API message', async () => {
    const { el, text, unmount } = await show(Response.json({ error: 'No encontramos datos de ese ticker. Revisá cómo está escrito.' }, { status: 404 }), 'XXXX')
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('No encontramos datos de ese ticker.')
    expect(text()).not.toContain('Reintentar')
    unmount()
  })

  it('a failed load offers to retry', async () => {
    const { text, unmount } = await show(() => Response.json({ error: 'boom' }, { status: 500 }))
    expect(text()).toContain('Reintentar')
    unmount()
  })

  it('asks for the asked ticker and forwards ?vs=', async () => {
    const { urls, unmount } = await show(Response.json(PAGE), 'BCBA:GGAL', 'AMZN,SE')
    expect(urls).toEqual(['/api/asset/BCBA%3AGGAL?vs=AMZN%2CSE'])
    unmount()
  })
})

describe('AssetTabs', () => {
  const tab = (id: string, label: string) => ({ id, label, content: <p>{label} contenido</p> })

  async function mount(tabs: ReturnType<typeof tab>[]) {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => { root.render(<AssetTabs tabs={tabs} />) })
    return { el, unmount: () => act(() => root.unmount()) }
  }

  it('hides the bar with a single tab', async () => {
    const { el, unmount } = await mount([tab('numeros', 'Números')])
    expect(el.querySelector('[role="tablist"]')).toBeNull()
    expect(el.textContent).toBe('Números contenido')
    unmount()
  })

  it('shows the bar with several, the first one selected', async () => {
    const { el, unmount } = await mount([tab('resumen', 'Resumen'), tab('numeros', 'Números')])
    const tabs = [...el.querySelectorAll<HTMLElement>('[role="tab"]')]
    expect(tabs.map(t => t.textContent)).toEqual(['Resumen', 'Números'])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    act(() => { tabs[1].click() })
    expect(el.querySelector('[role="tabpanel"]')!.textContent).toBe('Números contenido')
    unmount()
  })
})
