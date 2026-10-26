import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { toast } from 'sonner'
import { Watchlist } from '../Watchlist'
import { useChartStore } from '@/lib/store/chart-store'
import { NO_CONNECTION } from '@/lib/request-errors'
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

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); document.body.innerHTML = '' })

type Handler = (init?: RequestInit) => Response | Promise<Response>
function stubFetch(items: Handler, remove?: Handler) {
  const calls: { url: string; method: string }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ url, method })
    if (url === '/api/watchlist/lists') return Response.json({ lists: [{ id: 'w1', name: 'Mi lista', item_count: 1 }] })
    if (url.startsWith('/api/quote')) return Response.json([])
    if (url.startsWith('/api/watchlist?') && method === 'DELETE' && remove) return remove(init)
    if (url.startsWith('/api/watchlist?')) return items(init)
    throw new Error(`unexpected fetch ${method} ${url}`)
  }))
  return calls
}

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.includes(text))
const removeButton = (s: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="Quitar ${s} de la lista"]`)

async function render(activeWatchlistId: string | null = 'w1', watchlist: string[] = []) {
  useChartStore.setState({ activeWatchlistId, watchlist })
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<Watchlist />) })
  await flush()
  return { el, unmount: () => act(() => root.unmount()) }
}

const listOf = (...symbols: string[]) => () => Response.json({ items: symbols.map(symbol => ({ symbol })) })

describe('Watchlist — a failed load never looks like an empty list', () => {
  it('says the load failed with the server message and Reintentar; the retry loads the list', async () => {
    let attempt = 0
    const calls = stubFetch(() => (++attempt === 1
      ? Response.json({ error: 'No encontramos esa lista' }, { status: 404 })
      : Response.json({ items: [] })))
    const { el, unmount } = await render()

    expect(el.querySelector('[role="alert"]')?.textContent).toContain('No encontramos esa lista')
    expect(el.textContent).not.toContain('La lista está vacía.')

    act(() => button('Reintentar')!.click())
    await flush()

    expect(calls.filter(c => c.url.startsWith('/api/watchlist?') && c.method === 'GET')).toHaveLength(2)
    expect(el.querySelector('[role="alert"]')).toBeNull()
    expect(el.textContent).toContain('La lista está vacía.')
    unmount()
  })

  it('a load that never reached the server says there is no connection', async () => {
    stubFetch(() => { throw new TypeError('Failed to fetch') })
    const { el, unmount } = await render()

    expect(el.querySelector('[role="alert"]')?.textContent).toContain(NO_CONNECTION)
    expect(el.textContent).not.toContain('Failed to fetch')
    expect(el.textContent).not.toContain('La lista está vacía.')
    unmount()
  })

  it('a non-JSON error page shows the Spanish fallback', async () => {
    stubFetch(() => new Response('<html>502</html>', { status: 502 }))
    const { el, unmount } = await render()

    expect(el.querySelector('[role="alert"]')?.textContent).toContain('No se pudo cargar la lista.')
    unmount()
  })
})

describe('Watchlist — removing a symbol', () => {
  it('disables the button while the request is in flight, then removes the row and confirms', async () => {
    let answer!: (r: Response) => void
    const calls = stubFetch(listOf('AAPL'), () => new Promise<Response>(r => { answer = r }))
    const { el, unmount } = await render()

    act(() => removeButton('AAPL')!.click())
    await flush()
    expect(removeButton('AAPL')!.disabled).toBe(true)
    expect(calls.find(c => c.method === 'DELETE')!.url).toBe('/api/watchlist?symbol=AAPL&watchlistId=w1')

    await act(async () => { answer(Response.json({ success: true })) })
    await flush()

    expect(removeButton('AAPL')).toBeNull()
    expect(toast.success).toHaveBeenCalledWith('Quitado de la lista', { description: 'AAPL' })
    expect(toast.error).not.toHaveBeenCalled()
    expect(el.textContent).toContain('La lista está vacía.')
    unmount()
  })

  it('a refused remove shows the server message and keeps the row', async () => {
    stubFetch(listOf('AAPL'), () => Response.json({ error: 'Ese ticker no está en la lista' }, { status: 404 }))
    const { unmount } = await render()

    act(() => removeButton('AAPL')!.click())
    await flush()

    expect(toast.error).toHaveBeenCalledWith('Ese ticker no está en la lista')
    expect(toast.success).not.toHaveBeenCalled()
    expect(removeButton('AAPL')!.disabled).toBe(false)
    unmount()
  })

  it('a remove that never reached the server says there is no connection', async () => {
    stubFetch(listOf('AAPL'), () => { throw new TypeError('Failed to fetch') })
    const { unmount } = await render()

    act(() => removeButton('AAPL')!.click())
    await flush()

    expect(toast.error).toHaveBeenCalledWith(NO_CONNECTION)
    expect(removeButton('AAPL')).not.toBeNull()
    unmount()
  })

  it('a remove that fails without a message shows the Spanish fallback', async () => {
    stubFetch(listOf('AAPL'), () => new Response('<html>500</html>', { status: 500 }))
    const { unmount } = await render()

    act(() => removeButton('AAPL')!.click())
    await flush()

    expect(toast.error).toHaveBeenCalledWith('No se pudo quitar AAPL de la lista')
    unmount()
  })

  it('the local list (no saved list chosen) still removes in place, without a request', async () => {
    const calls = stubFetch(listOf())
    const { unmount } = await render(null, ['AAPL', 'MSFT'])

    act(() => removeButton('AAPL')!.click())
    await flush()

    expect(useChartStore.getState().watchlist).toEqual(['MSFT'])
    expect(calls.some(c => c.method === 'DELETE')).toBe(false)
    expect(toast.success).toHaveBeenCalledWith('Quitado de la lista', { description: 'AAPL' })
    unmount()
  })
})

describe('Watchlist — Cartera, the stocks held', () => {
  const POSITIONS = [
    { ticker: 'AAPL', market_value: 300, day_change_pct: 2 },
    { ticker: 'GGAL', market_value: 100, day_change_pct: -2 },
  ]
  function stubPortfolio(positions: unknown[] = POSITIONS) {
    forgetCached()
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      if (url === '/api/positions') return Response.json({ positions, onPositions: [], summary: {}, lastRefresh: null })
      if (url.startsWith('/api/quote')) return Response.json([])
      if (url === '/api/watchlist/lists') return Response.json({ lists: [] })
      throw new Error(`unexpected fetch ${url}`)
    }))
    return calls
  }
  const rowNames = (el: HTMLElement) => [...el.querySelectorAll('ul[aria-label="Símbolos de la lista"] li')].map((li) => li.querySelector('button')!.textContent)

  it('shows Mi cartera with today’s change of the stocks, then each stock held; nothing to add or remove', async () => {
    const calls = stubPortfolio()
    const { el, unmount } = await render('__cartera__')

    expect(rowNames(el)).toEqual([expect.stringContaining('Mi cartera'), expect.stringContaining('AAPL'), expect.stringContaining('GGAL')])
    expect(rowNames(el)[0]).toContain('Rendimiento de las acciones')
    expect(rowNames(el)[0]).toContain('1,00')
    expect(el.querySelector('button[aria-label^="Quitar"]')).toBeNull()
    expect(el.querySelector('button[aria-label="Agregar símbolo"]')).toBeNull()
    expect(calls.some((u) => u.startsWith('/api/watchlist?'))).toBe(false)
    unmount()
  })

  it('Mi cartera opens the portfolio chart; a stock opens its own', async () => {
    stubPortfolio()
    const { unmount } = await render('__cartera__')

    act(() => button('Mi cartera')!.click())
    expect(useChartStore.getState().symbol).toBe('__portfolio__')
    act(() => button('GGAL')!.click())
    expect(useChartStore.getState().symbol).toBe('GGAL')
    unmount()
  })

  it('with nothing held it says so', async () => {
    stubPortfolio([])
    const { el, unmount } = await render('__cartera__')

    expect(el.textContent).toContain('No tenés acciones en cartera')
    expect(el.textContent).not.toContain('Mi cartera')
    unmount()
  })
})
