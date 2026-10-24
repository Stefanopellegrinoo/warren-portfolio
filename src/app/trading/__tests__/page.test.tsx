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
const nav = vi.hoisted(() => ({ query: new URLSearchParams(), charts: [] as string[] }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/trading',
  useSearchParams: () => nav.query,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
// The chart core has its own tests; here it only has to mount once.
vi.mock('@/components/trading/chart/TradingChart', () => ({
  TradingChart: ({ symbol }: { symbol: string }) => { nav.charts.push(symbol); return <div data-chart={symbol} /> },
}))

import TradingPage from '../page'
import { Watchlist } from '@/components/trading/watchlist/Watchlist'
import { useChartStore } from '@/lib/store/chart-store'

const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body } as Response)

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url: string) => ok(String(url).includes('/lists') ? { lists: [] } : [])))
  useChartStore.setState({ symbol: 'SPY', watchlist: ['SPY', 'QQQ'], activeWatchlistId: null })
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
