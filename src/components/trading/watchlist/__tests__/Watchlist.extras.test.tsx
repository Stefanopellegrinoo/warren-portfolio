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
// The crypto row's price comes over the Binance socket; this file is about the extras.
vi.mock('@/lib/binance/ws', () => ({ getBinanceWS: () => ({ subscribeMiniTickers: () => () => {} }) }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NAMES_KEY = 'warren:watchlist-names'
// A month of daily bars, rising for AAPL and falling for MSFT.
const bars = (from: number, step: number) => Array.from({ length: 24 }, (_, i) => ({ time: `2026-09-${String(i + 1).padStart(2, '0')}`, open: 1, high: 1, low: 1, close: from + i * step }))
const binanceBars = Array.from({ length: 22 }, (_, i) => [i * 86_400_000, '1', '1', '1', String(100 - i), '1'])

let urls: string[]
beforeEach(() => {
  localStorage.clear()
  forgetCached()
  urls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url)
    if (url === '/api/watchlist/lists') return Response.json({ lists: [] })
    if (url.startsWith('/api/quote')) return Response.json([{ ticker: 'AAPL', price: 200, change_pct: 1 }, { ticker: 'MSFT', price: 400, change_pct: -1 }])
    if (url === '/api/ticker/search?q=AAPL') return Response.json({ results: [{ symbol: 'AAPLW', shortname: 'Not this one' }, { symbol: 'AAPL', shortname: 'Apple Inc.' }] })
    if (url === '/api/ticker/search?q=MSFT') return Response.json({ results: [{ symbol: 'MSFT', shortname: 'Microsoft Corporation' }] })
    if (url.startsWith('/api/klines?ticker=AAPL')) return Response.json(bars(100, 1))
    if (url.startsWith('/api/klines?ticker=MSFT')) return Response.json(bars(300, -1))
    if (url.includes('api.binance.com/api/v3/ticker/24hr')) return Response.json([])
    if (url.includes('api.binance.com/api/v3/klines')) return Response.json(binanceBars)
    throw new Error(`unexpected fetch ${url}`)
  }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); document.body.innerHTML = '' })

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
// The month line (the remove button's X is an svg too).
const lineOf = (li: Element) => li.querySelector('polyline')?.closest('svg') ?? null
const extraRequests = () => urls.filter(u => u.startsWith('/api/ticker/search') || u.includes('klines'))

async function render(width?: number, watchlist = ['AAPL', 'MSFT'], symbol = 'AAPL') {
  useChartStore.setState({ activeWatchlistId: null, watchlist, symbol })
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<Watchlist width={width} />) })
  await flush()
  const row = (s: string) => [...el.querySelectorAll('ul[aria-label="Símbolos de la lista"] li')].find(li => li.querySelector('button')!.textContent!.includes(s))!
  return {
    el, row,
    rerender: async (w?: number) => { await act(async () => { root.render(<Watchlist width={w} />) }); await flush() },
    unmount: () => act(() => root.unmount()),
  }
}

describe('Watchlist — wider shows more, fetched only when that wide', () => {
  it('at the default 280 px (or with no width) it asks for no name and no line', async () => {
    for (const width of [undefined, 280, 359]) {
      const { el, unmount } = await render(width)
      expect(extraRequests()).toEqual([])
      expect(el.textContent).not.toContain('Apple Inc.')
      expect(el.querySelector('svg polyline')).toBeNull()
      expect(el.textContent).not.toContain('1 mes')
      unmount()
    }
  })

  it('from 360 px each asset shows its name under the symbol, from the symbol search, matched exactly', async () => {
    const { row, unmount } = await render(360)

    expect(urls).toContain('/api/ticker/search?q=AAPL')
    expect(row('AAPL').textContent).toContain('Apple Inc.')
    expect(row('AAPL').textContent).not.toContain('Not this one')
    expect(row('MSFT').textContent).toContain('Microsoft Corporation')
    // Names only: no line yet.
    expect(urls.some(u => u.includes('klines'))).toBe(false)
    expect(lineOf(row('AAPL'))).toBeNull()
    unmount()
  })

  it('a name is fetched once and kept on the device for the next visit', async () => {
    const first = await render(400)
    first.unmount()
    expect(JSON.parse(localStorage.getItem(NAMES_KEY)!)).toEqual({ AAPL: 'Apple Inc.', MSFT: 'Microsoft Corporation' })

    forgetCached() // a new tab: nothing in memory, the device copy remains
    urls.length = 0
    const again = await render(400)

    expect(again.row('AAPL').textContent).toContain('Apple Inc.')
    expect(extraRequests()).toEqual([])
    again.unmount()
  })

  it('a search that fails or finds no exact match leaves the symbol alone, and is not asked again', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      urls.push(url)
      if (url === '/api/watchlist/lists') return Response.json({ lists: [] })
      if (url.startsWith('/api/quote')) return Response.json([])
      if (url === '/api/ticker/search?q=AAPL') return Response.json({ error: 'No se pudo buscar' }, { status: 500 })
      if (url === '/api/ticker/search?q=MSFT') return Response.json({ results: [{ symbol: 'MSFT.BA', shortname: 'Other' }] })
      throw new Error(`unexpected fetch ${url}`)
    })
    const { el, row, rerender, unmount } = await render(400)

    expect(row('AAPL').textContent).toContain('AAPL')
    expect(el.textContent).not.toContain('No se pudo buscar')
    expect(el.textContent).not.toContain('Other')
    await rerender(420)
    expect(urls.filter(u => u.startsWith('/api/ticker/search'))).toHaveLength(2)
    unmount()
  })

  it('from 460 px a "1 mes" column draws the last 22 daily closes, green when up and red when down', async () => {
    const { el, row, unmount } = await render(460)

    expect(el.textContent).toContain('1 mes')
    expect(urls).toContain('/api/klines?ticker=AAPL&interval=1d&days=35')
    const up = lineOf(row('AAPL'))!
    const down = lineOf(row('MSFT'))!
    expect(up.querySelector('polyline')!.getAttribute('points')!.split(' ')).toHaveLength(22)
    expect(up.getAttribute('class')).toContain('text-ok')
    expect(down.getAttribute('class')).toContain('text-danger')
    unmount()
  })

  it('a crypto line comes from Binance the way the chart loads it, 22 daily bars', async () => {
    const { row, unmount } = await render(480, ['BTCUSDT'], 'BTCUSDT')

    expect(urls).toContain('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=22')
    expect(lineOf(row('BTC'))!.getAttribute('class')).toContain('text-danger')
    // No name source for crypto: the symbol and its USDT tag, as today.
    expect(urls.some(u => u.startsWith('/api/ticker/search'))).toBe(false)
    unmount()
  })

  it('each line is fetched once per symbol for the session, even after narrowing and widening again', async () => {
    const { rerender, unmount } = await render(500)
    await rerender(280)
    await rerender(500)
    unmount()
    const again = await render(500)

    expect(urls.filter(u => u.startsWith('/api/klines?ticker=AAPL'))).toHaveLength(1)
    expect(lineOf(again.row('AAPL'))).not.toBeNull()
    again.unmount()
  })

  it('rows keep their columns aligned: the same fixed grid on the header and on every row', async () => {
    const { el, unmount } = await render(500)

    const grids = [el.querySelector('[aria-hidden="true"].grid')!, ...el.querySelectorAll('ul li > button:first-of-type')].map(n => n.className.match(/grid-cols-\[[^\]]+\]/)![0])
    expect(new Set(grids)).toEqual(new Set(['grid-cols-[minmax(0,1fr)_76px_96px_76px]']))
    unmount()
  })
})

describe('Watchlist — a wide list keeps what the list does today', () => {
  it('the rows show price and day change, the active row is marked, a row opens its chart', async () => {
    const { row, unmount } = await render(500)

    expect(row('AAPL').textContent).toContain('200,00')
    expect(row('MSFT').textContent).toContain('400,00')
    expect(row('AAPL').querySelector('button')!.getAttribute('aria-current')).toBe('true')
    expect(row('MSFT').querySelector('button')!.getAttribute('aria-current')).toBeNull()

    act(() => row('MSFT').querySelector('button')!.click())
    expect(useChartStore.getState().symbol).toBe('MSFT')
    unmount()
  })

  it('removing a symbol still works', async () => {
    const { el, unmount } = await render(500)

    act(() => el.querySelector<HTMLButtonElement>('button[aria-label="Quitar MSFT de la lista"]')!.click())
    await flush()

    expect(useChartStore.getState().watchlist).toEqual(['AAPL'])
    unmount()
  })
})
