import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { forgetCached } from '@/lib/client-cache'
import type { AssetPage } from '@/lib/fundamentals/service'
import type { Metrics } from '@/lib/fundamentals/metrics'

// odd/tasks/asset-page.md S1: the page shell. Each tab is tested on its own; here it only has to appear.
vi.mock('@/components/asset/numeros/NumerosTab', () => ({ NumerosTab: () => <p>Pestaña Números</p> }))
vi.mock('@/components/asset/resumen/ResumenTab', () => ({
  ResumenTab: ({ onOpen }: { onOpen: (id: string) => void }) => (
    <p>Pestaña Resumen <button type="button" onClick={() => onOpen('pe')}>Ver P/E</button></p>
  ),
}))
vi.mock('@/components/asset/comparar/ComparaTab', () => ({
  ComparaTab: ({ page }: { page: AssetPage }) => <p>Pestaña Comparar con {page.peers.map((p) => p.tvSymbol).join(',') || 'nadie'}</p>,
}))
vi.mock('@/components/asset/noticias/NoticiasTab', () => ({ NoticiasTab: ({ ticker }: { ticker: string }) => <p>Pestaña Noticias de {ticker}</p> }))
vi.mock('@/components/asset/resumen/OtherResumen', () => ({
  FundResumen: () => <p>Resumen del fondo</p>,
  CryptoResumen: () => <p>Resumen de la cripto</p>,
}))
vi.mock('@/components/asset/composicion/ComposicionTab', () => ({ ComposicionTab: () => <p>Pestaña Composición</p> }))

import AssetView, { AssetTabs } from '../AssetView'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { vi.unstubAllGlobals(); forgetCached(); document.body.innerHTML = ''; window.history.replaceState(null, '', '/') })

const withNumbers = { pe: { id: 'pe', today: 45.2, history: { quarterly: [], ttm: [], annual: [] }, since: null, source: 'tradingview' } } as unknown as Metrics
const onlySnapshot = { beta: { id: 'beta', today: 1.1, history: { quarterly: [], ttm: [], annual: [] }, since: null, source: 'snapshot' } } as unknown as Metrics

const PAGE: AssetPage = {
  ticker: 'MELI', name: 'MercadoLibre, Inc.', exchange: 'NASDAQ', price: 1660.13, currency: 'USD', supported: true,
  listing: { ticker: 'MELI', market: 'america', tvSymbol: 'NASDAQ:MELI', yahooSymbol: 'MELI' },
  bymaListing: false, metrics: withNumbers, peers: [], sources: { tradingview: 'ok', yahoo: 'ok' },
}

async function show(answer: Response | (() => Response | Promise<Response>), ticker = 'MELI', vs?: string) {
  const urls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url)
    return typeof answer === 'function' ? answer() : answer.clone()
  }))
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  const render = async (v = vs, t = ticker) => {
    await act(async () => { root.render(<AssetView ticker={t} vs={v} />) })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  }
  await render()
  return { el, urls, render, text: () => el.textContent ?? '', unmount: () => act(() => root.unmount()) }
}

const tabNames = (el: Element) => [...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent)
const selected = (el: Element) => el.querySelector('[role="tab"][aria-selected="true"]')?.textContent
const tabButton = (el: Element, name: string) => [...el.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === name)!

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

  it('with numbers, shows Resumen · Números · Comparar · Noticias, Resumen open by default', async () => {
    const { el, text, unmount } = await show(Response.json(PAGE))
    expect(tabNames(el)).toEqual(['Resumen', 'Números', 'Comparar', 'Noticias'])
    expect(selected(el)).toBe('Resumen')
    expect(text()).toContain('Pestaña Resumen')
    act(() => { tabButton(el, 'Noticias').click() })
    expect(text()).toContain('Pestaña Noticias de MELI')
    unmount()
  })

  it('keeps the open tab in ?tab=: a click writes it, a reload and back read it, ?dato= alone means Números', async () => {
    window.history.replaceState(null, '', '/activo/MELI?vs=AMZN')
    let view = await show(Response.json(PAGE))
    act(() => { tabButton(view.el, 'Comparar').click() })
    expect(window.location.search).toBe('?vs=AMZN&tab=comparar')
    view.unmount()

    // A reload opens the tab the URL names.
    view = await show(Response.json(PAGE))
    expect(selected(view.el)).toBe('Comparar')
    // Back and forward too.
    act(() => {
      window.history.replaceState(null, '', '/activo/MELI?tab=noticias')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(selected(view.el)).toBe('Noticias')
    // The default tab leaves the URL clean; leaving Números drops its open metric.
    window.history.replaceState(null, '', '/activo/MELI?tab=numeros&dato=pe')
    act(() => { tabButton(view.el, 'Resumen').click() })
    expect(window.location.search).toBe('')
    view.unmount()

    // Números' own links (?dato=) keep opening Números.
    window.history.replaceState(null, '', '/activo/MELI?dato=pe')
    view = await show(Response.json(PAGE))
    expect(selected(view.el)).toBe('Números')
    view.unmount()
  })

  it('?vista=balances alone means Números, and leaving Números closes it', async () => {
    window.history.replaceState(null, '', '/activo/MELI?vista=balances')
    const view = await show(Response.json(PAGE))
    expect(selected(view.el)).toBe('Números')

    act(() => { tabButton(view.el, 'Comparar').click() })

    expect(window.location.search).toBe('?tab=comparar')
    view.unmount()
  })

  it("a Resumen number opens its row in Números, and back returns to Resumen", async () => {
    window.history.replaceState(null, '', '/activo/MELI')
    const { el, text, unmount } = await show(Response.json(PAGE))
    const entries = window.history.length

    act(() => { [...el.querySelectorAll('button')].find((b) => b.textContent === 'Ver P/E')!.click() })

    expect(selected(el)).toBe('Números')
    expect(window.location.search).toBe('?tab=numeros&dato=pe')
    expect(window.history.length).toBe(entries + 1)
    expect(text()).toContain('Pestaña Números')

    await act(async () => {
      const back = new Promise((r) => window.addEventListener('popstate', r, { once: true }))
      window.history.back()
      await back
    })
    expect(selected(el)).toBe('Resumen')
    unmount()
  })

  it('keeps showing the page, on its tab, while a new ?vs= loads, then shows the new one', async () => {
    window.history.replaceState(null, '', '/activo/MELI?tab=comparar')
    let answer: (r: Response) => void = () => {}
    const view = await show(Response.json(PAGE))
    expect(view.text()).toContain('Pestaña Comparar con nadie')
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { answer = r })))

    await view.render('AMZN')

    expect(view.text()).toContain('Pestaña Comparar con nadie')
    expect(view.el.querySelector('[aria-label="Cargando MELI"]')).toBeNull()
    expect(selected(view.el)).toBe('Comparar')

    const withAmazon = { ...PAGE, peers: [{ tvSymbol: 'NASDAQ:AMZN', name: 'Amazon.com, Inc.', today: {} }] }
    await act(async () => { answer(Response.json(withAmazon)); await new Promise(r => setTimeout(r, 0)) })
    expect(view.text()).toContain('Pestaña Comparar con NASDAQ:AMZN')
    expect(selected(view.el)).toBe('Comparar')
    view.unmount()
  })

  it('a different ticker never shows the previous asset while it loads', async () => {
    const view = await show(Response.json(PAGE))
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))

    await view.render(undefined, 'GGAL')

    expect(view.el.querySelector('[aria-label="Cargando GGAL"]')).not.toBeNull()
    expect(view.text()).not.toContain('MercadoLibre')
    view.unmount()
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

  it('a market without fundamentals adds Noticias when its name is known (T10)', async () => {
    const page = { ...PAGE, ticker: '7203.T', name: 'Toyota Motor Corporation', exchange: 'Tokyo', price: 2900, currency: null, supported: false, listing: null, metrics: null, sources: {} }
    const view = await show(Response.json(page), '7203.T')
    expect(tabNames(view.el)).toEqual(['Resumen', 'Noticias'])
    expect(view.text()).toContain('Todavía no tenemos datos financieros de este mercado')
    act(() => { tabButton(view.el, 'Noticias').click() })
    expect(view.text()).toContain('Pestaña Noticias de 7203.T')
    view.unmount()

    // Yahoo had no name for it: nothing to search the news by.
    const nameless = await show(Response.json({ ...page, name: '7203.T' }), '7203.T')
    expect(nameless.el.querySelector('[role="tablist"]')).toBeNull()
    expect(nameless.text()).toContain('Todavía no tenemos datos financieros de este mercado')
    nameless.unmount()
  })

  it('an ETF shows Resumen · Composición · Noticias (T10)', async () => {
    const page = { ...PAGE, ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust', kind: 'etf', metrics: null } as AssetPage
    const { el, text, unmount } = await show(Response.json(page), 'SPY')
    expect(tabNames(el)).toEqual(['Resumen', 'Composición', 'Noticias'])
    expect(text()).toContain('Resumen del fondo')
    act(() => { tabButton(el, 'Composición').click() })
    expect(text()).toContain('Pestaña Composición')
    expect(window.location.search).toBe('?tab=composicion')
    unmount()
  })

  it('a coin shows Resumen · Noticias (T10)', async () => {
    const page = { ...PAGE, ticker: 'BTC-USD', name: 'Bitcoin USD', kind: 'crypto', supported: false, listing: null, metrics: null } as AssetPage
    const { el, text, unmount } = await show(Response.json(page), 'BTC-USD')
    expect(tabNames(el)).toEqual(['Resumen', 'Noticias'])
    expect(text()).toContain('Resumen de la cripto')
    expect(text()).not.toContain('Todavía no tenemos datos financieros')
    unmount()
  })

  it("an analysts' target alone is not financial data", async () => {
    const target = { priceTarget: { id: 'priceTarget', today: 70, history: { quarterly: [], ttm: [], annual: [] }, since: null, source: 'profile' } } as unknown as Metrics
    const { text, unmount } = await show(Response.json({ ...PAGE, metrics: { ...onlySnapshot, ...target } }))
    expect(text()).toContain('Todavía no tenemos datos financieros de este activo')
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
