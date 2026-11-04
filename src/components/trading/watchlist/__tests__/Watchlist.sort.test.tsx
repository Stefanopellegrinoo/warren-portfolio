// odd/tasks/extended-hours.md S3: an "Ext" column with each row's extended-hours %; S4: the list sorts
// by its headers, Mi cartera on top, one sort for every list kept on this device.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { Watchlist } from '../Watchlist'
import { useChartStore } from '@/lib/store/chart-store'
import { forgetCached } from '@/lib/client-cache'

// Node 25 ships a stub localStorage without methods; the persisted store needs a real one.
vi.hoisted(() => {
  const data = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), clear: () => data.clear() },
  })
})

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
// The crypto row's price comes from Binance's REST seed here; the socket stays quiet.
vi.mock('@/lib/binance/ws', () => ({ getBinanceWS: () => ({ subscribeMiniTickers: () => () => {} }) }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// As /api/quote sends it: % in percent units; `extended` null in the regular session or without one.
const QUOTES = [
  { ticker: 'AAPL', price: 200, change_pct: 1, extended: { session: 'pre', price: 201, change_pct: 0.5 } },
  { ticker: 'MSFT', price: 400, change_pct: -1, extended: { session: 'pre', price: 392, change_pct: -2 } },
  { ticker: 'NVDA', price: 100, change_pct: 3, extended: null },
]
const POSITIONS = [
  { ticker: 'AAPL', market_value: 300, day_change_pct: 0.02 },
  { ticker: 'GGAL', market_value: 100, day_change_pct: -0.02 },
]

beforeEach(() => {
  forgetCached()
  useChartStore.setState({ watchlistSort: null, symbol: 'SPY' })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/watchlist/lists') return Response.json({ lists: [{ id: 'w2', name: 'Otra', item_count: 3 }] })
    if (url.startsWith('/api/quote')) return Response.json(QUOTES)
    if (url === '/api/watchlist?watchlistId=w2') return Response.json({ items: [{ symbol: 'NVDA' }, { symbol: 'AAPL' }, { symbol: 'MSFT' }] })
    if (url === '/api/positions') return Response.json({ positions: POSITIONS, onPositions: [], summary: {}, lastRefresh: null })
    // From 360 px the list asks for names; none here, so each row reads as its symbol.
    if (url.startsWith('/api/ticker/search')) return Response.json({ results: [] })
    if (url.includes('api.binance.com/api/v3/ticker/24hr')) return Response.json([{ symbol: 'BTCUSDT', lastPrice: '50000', priceChangePercent: '2' }])
    throw new Error(`unexpected fetch ${url}`)
  }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); document.body.innerHTML = '' })

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

// Ext shows from 375 px (EXT_FROM_PX).
async function render(activeWatchlistId: string | null = null, watchlist = ['MSFT', 'BTCUSDT', 'AAPL', 'NVDA'], width = 375) {
  useChartStore.setState({ activeWatchlistId, watchlist })
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<Watchlist width={width} />) })
  await flush()
  const items = () => [...el.querySelectorAll('ul[aria-label="Símbolos de la lista"] li')]
  const row = (s: string) => items().find(li => li.querySelector('button')!.firstElementChild!.textContent === s)!
  return {
    el, row,
    order: () => items().map(li => li.querySelector('button')!.firstElementChild!.textContent),
    // The row's last cell: Ext.
    ext: (s: string) => row(s).querySelector('button')!.lastElementChild!,
    click: (label: string) => act(() => el.querySelector<HTMLButtonElement>(`button[aria-label="Ordenar por ${label}"]`)!.click()),
    ariaSort: (label: string) => el.querySelector(`button[aria-label="Ordenar por ${label}"]`)!.closest('[role="columnheader"]')!.getAttribute('aria-sort'),
    unmount: () => act(() => root.unmount()),
  }
}

describe('Watchlist — the Ext column (S3)', () => {
  it('is headed "Ext" after "Var. día" and shows each row’s extended-hours %, green when up and red when down', async () => {
    const { el, ext, unmount } = await render()

    const headers = [...el.querySelectorAll('[role="columnheader"]')].map(h => h.textContent)
    expect(headers).toEqual(['Símbolo', 'Precio', 'Var. día', 'Ext'])
    expect(ext('AAPL').textContent).toBe('+0,50 %')
    expect(ext('AAPL').querySelector('span')!.className).toContain('text-ok')
    expect(ext('MSFT').textContent).toBe('−2,00 %')
    expect(ext('MSFT').querySelector('span')!.className).toContain('text-danger')
    unmount()
  })

  it('is left out below 375 px, as before, and a sort by it waits for the column', async () => {
    useChartStore.setState({ watchlistSort: { key: 'ext', dir: 'desc' } })
    const { el, row, order, unmount } = await render(null, undefined, 374)

    expect([...el.querySelectorAll('[role="columnheader"]')].map(h => h.textContent)).toEqual(['Símbolo', 'Precio', 'Var. día'])
    expect(row('AAPL').querySelector('button')!.lastElementChild!.textContent).toBe('+1,00 %')
    expect(order()).toEqual(['MSFT', 'BTCUSDT', 'AAPL', 'NVDA'])
    unmount()
  })

  it('shows "—" for a quote without one and for a crypto row', async () => {
    const { ext, unmount } = await render()

    expect(ext('NVDA').textContent).toBe('—')
    expect(ext('BTCUSDT').textContent).toBe('—')
    unmount()
  })

  it('leaves the price and the day % as they were, and without a sort the list keeps its own order', async () => {
    const { row, order, unmount } = await render()

    expect(order()).toEqual(['MSFT', 'BTCUSDT', 'AAPL', 'NVDA'])
    expect(row('AAPL').textContent).toContain('200,00')
    expect(row('AAPL').textContent).toContain('+1,00 %')
    expect(row('MSFT').textContent).toContain('400,00')
    expect(row('BTCUSDT').textContent).toContain('50.000,00')
    expect(row('BTCUSDT').textContent).toContain('+2,00 %')
    unmount()
  })
})

describe('Watchlist — sorting by a header (S4)', () => {
  it('Símbolo: A→Z, then Z→A, then the list’s own order, shown as aria-sort', async () => {
    const { order, click, ariaSort, unmount } = await render()
    expect(['Símbolo', 'Precio', 'Var. día', 'Ext'].map(ariaSort)).toEqual(['none', 'none', 'none', 'none'])

    click('Símbolo')
    expect(order()).toEqual(['AAPL', 'BTCUSDT', 'MSFT', 'NVDA'])
    expect(ariaSort('Símbolo')).toBe('ascending')
    click('Símbolo')
    expect(order()).toEqual(['NVDA', 'MSFT', 'BTCUSDT', 'AAPL'])
    expect(ariaSort('Símbolo')).toBe('descending')
    click('Símbolo')
    expect(order()).toEqual(['MSFT', 'BTCUSDT', 'AAPL', 'NVDA'])
    expect(ariaSort('Símbolo')).toBe('none')
    unmount()
  })

  it('Precio and Var. día: highest first, then lowest first, then the list’s own order', async () => {
    const { order, click, ariaSort, unmount } = await render()

    click('Precio')
    expect(order()).toEqual(['BTCUSDT', 'MSFT', 'AAPL', 'NVDA'])
    expect(ariaSort('Precio')).toBe('descending')
    click('Precio')
    expect(order()).toEqual(['NVDA', 'AAPL', 'MSFT', 'BTCUSDT'])
    expect(ariaSort('Precio')).toBe('ascending')
    click('Var. día')
    expect(order()).toEqual(['NVDA', 'BTCUSDT', 'AAPL', 'MSFT'])
    expect([ariaSort('Var. día'), ariaSort('Precio')]).toEqual(['descending', 'none'])
    click('Var. día')
    click('Var. día')
    expect(order()).toEqual(['MSFT', 'BTCUSDT', 'AAPL', 'NVDA'])
    unmount()
  })

  it('Ext: rows without a value go last in both directions', async () => {
    const { order, click, unmount } = await render()

    click('Ext')
    expect(order()).toEqual(['AAPL', 'MSFT', 'BTCUSDT', 'NVDA'])
    click('Ext')
    expect(order()).toEqual(['MSFT', 'AAPL', 'BTCUSDT', 'NVDA'])
    unmount()
  })

  it('Mi cartera stays on top of Cartera whatever the sort', async () => {
    const { el, order, click, unmount } = await render('__cartera__')

    click('Símbolo')
    click('Símbolo')
    expect(order()[0]).toContain('Mi cartera')
    expect(order().slice(1)).toEqual(['GGAL', 'AAPL'])
    // Its day % stays under "Var. día"; no extended hours for the portfolio.
    const cells = [...el.querySelector('ul li button')!.children].map(c => c.textContent)
    expect(cells.slice(-2)).toEqual(['+1,00 %', '—'])
    unmount()
  })

  it('is remembered on the device after a remount, and applies to another list', async () => {
    const first = await render()
    first.click('Precio')
    first.unmount()
    expect(JSON.parse(localStorage.getItem('tv-gratis-chart-state')!).state.watchlistSort).toEqual({ key: 'price', dir: 'desc' })

    const other = await render('w2')

    expect(other.order()).toEqual(['MSFT', 'AAPL', 'NVDA'])
    expect(other.ariaSort('Precio')).toBe('descending')
    other.unmount()
  })
})
