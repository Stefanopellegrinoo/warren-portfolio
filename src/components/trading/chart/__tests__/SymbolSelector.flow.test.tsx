import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { SymbolSelector } from '../SymbolSelector'
import { useChartStore } from '@/lib/store/chart-store'
import { NO_CONNECTION } from '@/lib/request-errors'

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

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

type Handler = () => Response | Promise<Response>
const EXCHANGE = () => Response.json({ symbols: [{ symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', status: 'TRADING' }] })
const POSITIONS = () => Response.json({ positions: [{ ticker: 'GGAL' }] })

function stubFetch({ exchange = EXCHANGE, positions = POSITIONS, search }: { exchange?: Handler; positions?: Handler; search?: Handler }) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url)
    if (url.includes('api.binance.com/api/v3/exchangeInfo')) return exchange()
    if (url === '/api/positions') return positions()
    if (url.startsWith('/api/ticker/search') && search) return search()
    throw new Error(`unexpected fetch ${url}`)
  }))
  return calls
}

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.includes(text))
const alerts = () => [...document.querySelectorAll('[role="alert"]')].map(a => a.textContent)

function type(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Símbolo"]')!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
// The search waits 300 ms after the last keystroke.
const afterDebounce = () => act(async () => { await new Promise(r => setTimeout(r, 350)) })

async function render() {
  useChartStore.setState({ symbolDialogOpen: true, symbol: 'AAPL' })
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<SymbolSelector />) })
  await flush()
  return { unmount: () => act(() => root.unmount()) }
}

// Binance's exchange list is cached once loaded, so its failure runs first.
describe('SymbolSelector — failed loads say so', () => {
  it('failed crypto and portfolio loads say so with Reintentar, in Spanish', async () => {
    let attempt = 0
    const calls = stubFetch({
      exchange: () => (++attempt === 1 ? new Response('{}', { status: 451 }) : EXCHANGE()),
      positions: () => { throw new TypeError('Failed to fetch') },
    })
    const { unmount } = await render()

    expect(alerts()).toEqual([
      expect.stringContaining(NO_CONNECTION),
      expect.stringContaining('No se pudo cargar la lista de cripto.'),
    ])
    expect(document.body.textContent).not.toContain('exchangeInfo')

    act(() => button('Reintentar')!.click())
    await flush()

    expect(calls.filter(u => u.includes('exchangeInfo'))).toHaveLength(2)
    expect(document.body.textContent).toContain('BTC / USDT')
    unmount()
  })
})

describe('SymbolSelector — a failed search is not "no results"', () => {
  it('shows "No se pudo buscar" with Reintentar; the retry shows the results', async () => {
    let attempt = 0
    const calls = stubFetch({
      search: () => (++attempt === 1
        ? new Response('<html>500</html>', { status: 500 })
        : Response.json({ results: [{ symbol: 'AAPL', shortname: 'Apple Inc.', quoteType: 'EQUITY', exchange: 'NMS' }] })),
    })
    const { unmount } = await render()

    type('AP')
    await afterDebounce()

    expect(alerts()).toEqual([expect.stringContaining('No se pudo buscar. Probá de nuevo.')])

    act(() => button('Reintentar')!.click())
    await flush()

    expect(calls.filter(u => u.startsWith('/api/ticker/search'))).toEqual(['/api/ticker/search?q=AP', '/api/ticker/search?q=AP'])
    expect(alerts()).toEqual([])
    expect(document.body.textContent).toContain('Apple Inc.')
    unmount()
  })

  it('a search the server refused shows its message', async () => {
    stubFetch({ search: () => Response.json({ error: 'El proveedor de precios recibió demasiados pedidos. Probá de nuevo en un minuto.' }, { status: 429 }) })
    const { unmount } = await render()

    type('AP')
    await afterDebounce()

    expect(alerts()).toEqual([expect.stringContaining('El proveedor de precios recibió demasiados pedidos.')])
    unmount()
  })

  it('a successful search still lists the results without an error', async () => {
    stubFetch({ search: () => Response.json({ results: [{ symbol: 'AAPL', shortname: 'Apple Inc.', quoteType: 'EQUITY', exchange: 'NMS' }] }) })
    const { unmount } = await render()

    type('AP')
    await afterDebounce()

    expect(alerts()).toEqual([])
    expect(document.body.textContent).toContain('Apple Inc.')
    unmount()
  })
})
