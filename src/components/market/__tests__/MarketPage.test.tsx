import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import MarketPage from '../MarketPage'
import { forgetCached } from '@/lib/client-cache'
import type { MarketBoard } from '@/lib/market-board'
import { memoryStorage } from '@/lib/chart/__tests__/memory-storage'

const params = { current: new URLSearchParams() }
vi.mock('next/navigation', () => ({ usePathname: () => '/mercado', useSearchParams: () => params.current }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const roots: Root[] = []
afterEach(async () => {
  await act(async () => { roots.splice(0).forEach((r) => r.unmount()) })
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  forgetCached()
  params.current = new URLSearchParams()
})

// Invented prices and names: no real portfolio data.
const board = (over: Partial<MarketBoard> = {}): MarketBoard => ({
  lider: [
    { symbol: 'PAMP', name: 'Pampa Energía', price: 4500, changePct: -0.008 },
    { symbol: 'GGAL', name: 'Grupo Galicia', price: 6000, changePct: 0.034 },
  ],
  locals: [
    { symbol: 'GGAL', name: 'Grupo Galicia', price: 6000, changePct: 0.034 },
    { symbol: 'PAMP', name: 'Pampa Energía', price: 4500, changePct: -0.008 },
  ],
  cedears: [{ symbol: 'AAPL', name: 'Apple', price: 15000, changePct: 0.012 }],
  fx: { mep: 1500, ccl: 1600 },
  marketOpen: true,
  updatedAt: new Date().toISOString(),
  ...over,
})

const routes = (b: MarketBoard) => ({
  '/api/market': b,
  '/api/watchlist/lists': { lists: [{ id: 'l1', name: 'Bancos', created_at: '2026-10-01', item_count: 2 }] },
  '/api/watchlist?watchlistId=l1&fields=symbols': { items: [{ id: 'i1', symbol: 'GGAL.BA', added_at: '2026-10-01' }, { id: 'i2', symbol: 'BTCUSDT', added_at: '2026-10-02' }] },
  '/api/positions': { positions: [{ ticker: 'AAPL' }], onPositions: [], summary: {}, lastRefresh: null },
})

async function mount(b = board()) {
  const answers = routes(b) as Record<string, unknown>
  const fetchMock = vi.fn(async (url: string) =>
    url in answers ? new Response(JSON.stringify(answers[url]), { status: 200 }) : new Response('{}', { status: 404 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('localStorage', memoryStorage())
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  roots.push(root)
  await act(async () => { root.render(<MarketPage />) })
  return { el, fetchMock }
}

const rowTexts = (el: HTMLElement) => [...el.querySelectorAll('table tbody tr')].map((tr) => tr.textContent ?? '')
const click = async (el: Element) => { await act(async () => { (el as HTMLElement).click() }) }
const listButton = (el: HTMLElement, name: string) =>
  [...el.querySelectorAll('nav[aria-label="Listas"] button')].find((b) => b.textContent?.startsWith(name))!

describe('MarketPage', () => {
  it('opens on the Panel líder, the day’s best first, in dólar MEP', async () => {
    const { el } = await mount()
    const rows = rowTexts(el)
    expect(rows[0]).toContain('GGAL')
    expect(rows[0]).toContain('US$ 4,00')
    expect(rows[0]).toContain('+3,40 %')
    expect(rows[1]).toContain('PAMP')
  })

  it('every row links its chart and its asset page by the stored symbol', async () => {
    const { el } = await mount()
    const links = [...el.querySelectorAll('table tbody tr')][0].querySelectorAll('a')
    expect([...links].map((a) => a.getAttribute('href'))).toEqual(['/trading?symbol=BCBA%3AGGAL', '/activo/BCBA%3AGGAL'])
  })

  it('switches to the CEDEARs and writes the list in the URL', async () => {
    const replace = vi.spyOn(window.history, 'replaceState')
    const { el } = await mount()
    await click(listButton(el, 'CEDEARs'))
    expect(rowTexts(el)).toHaveLength(1)
    expect(rowTexts(el)[0]).toContain('AAPL')
    expect(replace).toHaveBeenLastCalledWith(null, '', '/mercado?lista=cedears')
  })

  it('a list of the user shows its assets without asking a price per item, and says what does not trade on BYMA', async () => {
    const { el, fetchMock } = await mount()
    await click(listButton(el, 'Bancos'))
    const rows = rowTexts(el)
    expect(rows.some((r) => r.includes('GGAL') && r.includes('US$ 4,00'))).toBe(true)
    expect(rows.some((r) => r.includes('BTCUSDT') && r.includes('No cotiza en BYMA'))).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/watchlist?watchlistId=l1&fields=symbols')
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith('/api/quote'))).toBe(false)
  })

  it('Cartera lists the stocks held', async () => {
    const { el } = await mount()
    await click(listButton(el, 'Cartera'))
    expect(rowTexts(el)).toHaveLength(1)
    expect(rowTexts(el)[0]).toContain('AAPL')
  })

  it('shows pesos when asked, and remembers the choice like the Resumen', async () => {
    const { el } = await mount()
    const pesos = el.querySelector<HTMLInputElement>('input[name="resumen-currency"][value="ARS"]')!
    await click(pesos)
    expect(rowTexts(el)[0]).toContain('$ 6.000,00')
    expect(window.localStorage.getItem('resumen:currency')).toBe('ARS')
  })

  it('the search filters the list by ticker or name', async () => {
    const { el } = await mount()
    const input = el.querySelector<HTMLInputElement>('input[type="search"]')!
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(input, 'pampa')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(rowTexts(el)).toHaveLength(1)
    expect(rowTexts(el)[0]).toContain('PAMP')
  })

  it('a new list opens at once, and deleting the list on screen goes back to the Panel líder', async () => {
    const { el, fetchMock } = await mount()
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ id: 'l9', name: 'Energía' }), { status: 201 })
      if (url === '/api/watchlist?watchlistId=l9&fields=symbols') return new Response(JSON.stringify({ items: [] }), { status: 200 })
      return new Response('{}', { status: 200 })
    })
    const nav = el.querySelector('nav[aria-label="Listas"]')!
    await click([...nav.querySelectorAll('button')].find((b) => b.textContent === 'Nueva lista')!)
    const input = nav.querySelector('input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Energía')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { nav.querySelector('form')!.requestSubmit() })
    expect(listButton(el, 'Energía').getAttribute('aria-current')).toBe('true')
    expect(el.textContent).toContain('Esta lista está vacía')

    await click([...el.querySelectorAll('button')].find((b) => b.textContent === 'Eliminar lista')!)
    await click([...el.querySelectorAll('button')].find((b) => b.textContent === 'Eliminar')!)
    expect(fetchMock).toHaveBeenCalledWith('/api/watchlist/lists/l9', { method: 'DELETE' })
    expect(listButton(el, 'Panel líder').getAttribute('aria-current')).toBe('true')
  })

  it('a link to a list that no longer exists shows the Panel líder', async () => {
    params.current = new URLSearchParams('lista=gone')
    const { el } = await mount()
    expect(listButton(el, 'Panel líder').getAttribute('aria-current')).toBe('true')
    expect(rowTexts(el)[0]).toContain('GGAL')
  })

  it('Cartera and the market lists offer no rename or delete', async () => {
    const { el } = await mount()
    expect(el.textContent).not.toContain('Eliminar lista')
    await click(listButton(el, 'Cartera'))
    expect(el.textContent).not.toContain('Renombrar')
  })

  it('with the market closed it says the prices are the last close', async () => {
    const { el } = await mount(board({ marketOpen: false }))
    expect(el.textContent).toContain('Mercado cerrado, precios al cierre.')
  })
})
