import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// Node 25 ships a stub localStorage without methods; the persisted store needs a real one.
vi.hoisted(() => {
  const data = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), clear: () => data.clear() },
  })
})

// The URL's query and every symbol the chart was mounted with, for the ?symbol= tests.
const nav = vi.hoisted(() => ({ query: new URLSearchParams(), charts: [] as string[], phoneBar: null as HTMLElement | null }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/trading',
  useSearchParams: () => nav.query,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
// The chart core has its own tests; here it only has to mount once.
vi.mock('@/components/trading/chart/TradingChart', () => ({
  TradingChart: ({ symbol, phoneBar }: { symbol: string; phoneBar?: HTMLElement | null }) => { nav.charts.push(symbol); nav.phoneBar = phoneBar ?? null; return <div data-chart={symbol} /> },
}))

import TradingPage from '../page'
import { Watchlist } from '@/components/trading/watchlist/Watchlist'
import { useChartStore } from '@/lib/store/chart-store'

const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body } as Response)

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url: string) => ok(String(url).includes('/lists') ? { lists: [] } : [])))
  useChartStore.setState({ symbol: 'SPY', timeframe: '1d', watchlist: ['SPY', 'QQQ'], activeWatchlistId: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  nav.query = new URLSearchParams()
  nav.charts.length = 0
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe('TradingPage', () => {
  const html = () => renderToStaticMarkup(<TradingPage />)

  it('uses only the new design tokens: no tv-* classes and no uppercase micro-labels', () => {
    expect(html()).not.toMatch(/\btv-[a-z]/)
    expect(html()).not.toContain('uppercase')
  })

  it('has no bottom stats panel', () => {
    expect(html()).not.toContain('Binance · Live')
    expect(html()).not.toContain('Yahoo Finance · EOD')
  })

  it('mounts the chart exactly once', () => {
    expect(html().match(/data-chart="SPY"/g)).toHaveLength(1)
  })

  it('offers a two-option Gráfico / Lista switch, chart first', () => {
    const out = html()
    expect(out).toMatch(/role="radiogroup"[^>]*aria-label="Vista"/)
    expect(out).toMatch(/role="radio"[^>]*aria-checked="true"[^>]*>Gráfico</)
    expect(out).toMatch(/role="radio"[^>]*aria-checked="false"[^>]*>Lista</)
  })

  it('switching to Lista hides the chart on narrow screens but keeps it mounted', () => {
    act(() => root.render(<TradingPage />))
    const lista = [...host.querySelectorAll('[role="radio"]')].find(b => b.textContent === 'Lista') as HTMLButtonElement
    act(() => lista.click())
    expect(lista.getAttribute('aria-checked')).toBe('true')
    const pane = host.querySelector('[data-pane="chart"]')!
    expect(pane.className).toContain('max-[1099px]:hidden')
    expect(pane.querySelector('[data-chart]')).not.toBeNull()
  })
})

// odd/tasks/grafico-espacio.md S2: on a phone the top bar is one row, the rest moves to the bottom bar.
describe('TradingPage top bar on a phone', () => {
  const header = () => host.querySelector('header')!

  it('has the menu button, the symbol and the star', () => {
    act(() => root.render(<TradingPage />))
    expect(header().querySelector('button[aria-controls="sidebar"]')?.textContent).toBe('Abrir menú')
    expect(header().querySelector('[aria-label^="Cambiar símbolo"]')).not.toBeNull()
    expect(header().querySelector('[aria-label="SPY está en tu lista"]')).not.toBeNull()
  })

  it('leaves the timeframe, the indicators and the view switch to wider screens', () => {
    act(() => root.render(<TradingPage />))
    for (const name of ['Temporalidad', 'Indicadores', 'Vista']) {
      expect(header().querySelector(`[aria-label="${name}"]`)!.closest('.max-\\[819px\\]\\:hidden'), name).not.toBeNull()
    }
  })

  it('takes the whole screen height: there is no app bar above it', () => {
    act(() => root.render(<TradingPage />))
    expect((host.firstElementChild as HTMLElement).className).not.toContain('3.5rem')
  })
})

// odd/tasks/grafico-espacio.md S3: the phone's tool bar under the chart.
describe('TradingPage bottom bar on a phone', () => {
  const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
  const bar = () => host.querySelector<HTMLElement>('[role="toolbar"][aria-label="Herramientas del gráfico"]')!
  const inBar = (text: string) => [...bar().querySelectorAll('button')].find(b => b.textContent?.includes(text))

  it('is a phone-only bar under the chart', () => {
    act(() => root.render(<TradingPage />))
    expect(bar().className).toContain('min-[820px]:hidden')
    expect(host.querySelector('[data-pane="chart"]')!.compareDocumentPosition(bar()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('Intervalo shows the current one and opens the five to pick from', async () => {
    act(() => root.render(<TradingPage />))
    const intervalo = inBar('Intervalo')!
    expect(intervalo.textContent).toBe('1DIntervalo')

    act(() => intervalo.click())
    await flush()
    const popover = () => document.querySelector('[data-slot="popover-content"] [aria-label="Temporalidad"]')
    const radios = [...popover()!.querySelectorAll('[role="radio"]')]
    expect(radios.map(r => r.textContent)).toEqual(['15m', '1h', '1D', '1S', '1M'])

    act(() => (radios[3] as HTMLButtonElement).click())
    await flush()
    expect(useChartStore.getState().timeframe).toBe('1w')
    expect(inBar('Intervalo')!.textContent).toBe('1SIntervalo')
    expect(popover()).toBeNull()
  })

  it('Indicadores opens the same menu as on a computer', async () => {
    act(() => root.render(<TradingPage />))
    act(() => bar().querySelector<HTMLButtonElement>('[aria-label="Indicadores"]')!.click())
    await flush()
    expect(document.body.textContent).toContain('RSI (14)')
  })

  it('the chart gets a place in the bar for its drawing controls', () => {
    act(() => root.render(<TradingPage />))
    expect(nav.phoneBar).not.toBeNull()
    expect(bar().contains(nav.phoneBar)).toBe(true)
  })

  it('Lista shows the list, and the bar then offers only the way back', () => {
    act(() => root.render(<TradingPage />))
    act(() => inBar('Lista')!.click())
    expect(host.querySelector('[data-pane="chart"]')!.className).toContain('max-[1099px]:hidden')
    expect(inBar('Intervalo')).toBeUndefined()
    expect(bar().querySelector('[aria-label="Indicadores"]')).toBeNull()
    expect(nav.phoneBar!.className).toContain('hidden')

    act(() => inBar('Gráfico')!.click())
    expect(host.querySelector('[data-pane="chart"]')!.className).not.toContain('max-[1099px]:hidden')
    expect(inBar('Intervalo')).toBeDefined()
  })
})

describe('Watchlist', () => {
  it('selecting a row changes the chart symbol and tells the page', () => {
    const onSelect = vi.fn()
    act(() => root.render(<Watchlist onSelectSymbol={onSelect} />))
    const row = [...host.querySelectorAll('button')].find(b => b.textContent?.startsWith('QQQ'))!
    act(() => row.click())
    expect(useChartStore.getState().symbol).toBe('QQQ')
    expect(onSelect).toHaveBeenCalledWith('QQQ')
  })
})

describe('TradingPage opened on ?symbol=', () => {
  it('loads only the requested symbol, never the last one first', async () => {
    nav.query = new URLSearchParams('symbol=btcusdt')

    await act(async () => { root.render(<TradingPage />) })

    expect(new Set(nav.charts)).toEqual(new Set(['BTCUSDT']))
    const urls = vi.mocked(fetch).mock.calls.map(([u]) => String(u))
    // The chart's own quote is BTCUSDT's; SPY appears only in the watchlist's prices.
    expect(urls).toContain('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT')
    expect(urls).not.toContain('/api/quote?tickers=SPY')
    expect(useChartStore.getState().symbol).toBe('BTCUSDT')
  })

  it('without ?symbol= it opens on the last symbol', async () => {
    await act(async () => { root.render(<TradingPage />) })

    expect(new Set(nav.charts)).toEqual(new Set(['SPY']))
  })
})

describe('TradingPage — Mi cartera', () => {
  it('a link to a ticker wins over Mi cartera left open', () => {
    useChartStore.setState({ symbol: '__portfolio__' })
    nav.query = new URLSearchParams('symbol=AAPL')
    act(() => root.render(<TradingPage />))

    expect(nav.charts.at(-1)).toBe('AAPL')
  })

  it('is named Mi cartera, asks for no quote and has no star to add it to a list', async () => {
    useChartStore.setState({ symbol: '__portfolio__' })
    await act(async () => { root.render(<TradingPage />) })

    const header = host.querySelector('header')!
    expect(header.textContent).toContain('Mi cartera')
    expect(header.textContent).not.toContain('__portfolio__')
    expect(header.querySelector('button[aria-label^="Agregar"]')).toBeNull()
    const urls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.startsWith('/api/quote') && u.includes('portfolio'))).toBe(false)
  })

  it('never shows its internal name anywhere on the page', async () => {
    useChartStore.setState({ symbol: '__portfolio__' })
    await act(async () => { root.render(<TradingPage />) })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    expect(host.textContent).not.toContain('__portfolio__')
  })

  it('with Cartera chosen there is no star either: the list builds itself', async () => {
    useChartStore.setState({ symbol: 'AAPL', activeWatchlistId: '__cartera__' })
    await act(async () => { root.render(<TradingPage />) })

    expect(host.querySelector('header button[aria-label^="Agregar"]')).toBeNull()
  })
})

// odd/tasks/chart-pro-redesign.md S2: the page keeps which indicators are on, hidden or minimized in the account.
describe('TradingPage — indicators in the account', () => {
  it("shows the account's indicators once it answers", async () => {
    vi.resetModules()
    const kept = { rsi: { on: false, hidden: false, minimized: false }, obv: { on: true, hidden: true, minimized: false } }
    vi.stubGlobal('fetch', vi.fn((url: string) => ok(
      String(url) === '/api/chart-preferences'
        ? { userId: 'u1', preferences: { favorites: {}, toolStyles: {}, indicatorSettings: {}, indicatorVisibility: kept } }
        : String(url).includes('/lists') ? { lists: [] } : [],
    )))
    const { default: Page } = await import('../page')
    const { useChartStore: store } = await import('@/lib/store/chart-store')
    expect([store.getState().indicators.rsi, store.getState().indicators.obv]).toEqual([true, false])

    await act(async () => { root.render(<Page />) })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    const s = store.getState()
    expect([s.indicators.rsi, s.indicators.obv, s.hidden.obv]).toEqual([false, true, true])
  })
})
