import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import MarketPage from '../MarketPage'
import { forgetCached } from '@/lib/client-cache'
import { memoryStorage } from '@/lib/chart/__tests__/memory-storage'
import type { ViewRow } from '@/lib/market-view'

const params = { current: new URLSearchParams() }
vi.mock('next/navigation', () => ({ usePathname: () => '/mercado', useSearchParams: () => params.current }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const roots: Root[] = []
afterEach(async () => {
  await act(async () => { roots.splice(0).forEach((r) => r.unmount()) })
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.useRealTimers()
  forgetCached()
  params.current = new URLSearchParams()
})

// Invented prices and names: no real portfolio data.
const local = (ticker: string, name: string, price: number, changePct: number): ViewRow =>
  ({ key: `BCBA:${ticker}`, ticker, stored: `BCBA:${ticker}`, name, price, changePct, note: null, line: { kind: 'local', line: ticker } })
const cedear = (ticker: string, price: number, changePct: number): ViewRow =>
  ({ key: ticker, ticker, stored: ticker, name: `Empresa ${ticker}`, price, changePct, note: null, line: { kind: 'cedear', line: ticker } })
const LIDER = [local('GGAL', 'Grupo Galicia', 6000, 0.034), local('PAMP', 'Pampa Energía', 4500, -0.008)]
const CEDEARS = Array.from({ length: 30 }, (_, i) => cedear(`C${String(i).padStart(2, '0')}`, 1000 + i, 0.01))
const BY_SYMBOL: Record<string, ViewRow> = {
  'GGAL.BA': LIDER[0],
  AAPL: cedear('AAPL', 15000, 0.012),
  BTCUSDT: { key: 'BTCUSDT', ticker: 'BTCUSDT', stored: 'BTCUSDT', name: null, price: null, changePct: null, note: 'No cotiza en BYMA', line: null },
}

/** The server's paged answer, sliced like the real route; the order is the fixture's. */
function marketPage(url: URL, marketOpen: boolean) {
  const q = url.searchParams
  const symbols = q.get('symbols')
  const all = symbols !== null ? symbols.split(',').map((s) => BY_SYMBOL[s]) : q.get('list') === 'cedears' ? CEDEARS : LIDER
  const size = Number(q.get('size'))
  const pages = Math.max(1, Math.ceil(all.length / size))
  const page = Math.min(Number(q.get('page')), pages)
  return {
    rows: all.slice((page - 1) * size, page * size), total: all.length, page, size, pages,
    counts: { lider: LIDER.length, cedears: CEDEARS.length },
    fx: { mep: 1500, ccl: 1600 }, marketOpen, updatedAt: new Date().toISOString(),
  }
}

function stub({ marketOpen = true } = {}) {
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'https://warren.example')
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    if (init?.method === 'POST' && url.pathname === '/api/watchlist/lists') return json({ id: 'l9', name: 'Energía' }, 201)
    if (init?.method) return json({})
    if (url.pathname === '/api/market') return json(marketPage(url, marketOpen))
    if (url.pathname === '/api/watchlist/lists') {
      return json({ lists: [{ id: 'l1', name: 'Bancos', created_at: '2026-10-01', item_count: 2 }, { id: 'l2', name: 'Vacía', created_at: '2026-10-02', item_count: 0 }] })
    }
    if (url.pathname === '/api/watchlist') {
      const items = url.searchParams.get('watchlistId') === 'l1' ? ['GGAL.BA', 'BTCUSDT'] : []
      return json({ items: items.map((symbol, i) => ({ id: `i${i}`, symbol, added_at: '2026-10-01' })) })
    }
    if (url.pathname === '/api/positions') return json({ positions: [{ ticker: 'AAPL' }], onPositions: [], summary: {}, lastRefresh: null })
    return json({}, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('localStorage', memoryStorage())
  return fetchMock
}

async function mount(opts?: { marketOpen?: boolean }) {
  const fetchMock = stub(opts)
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  roots.push(root)
  await act(async () => { root.render(<MarketPage />) })
  return { el, fetchMock }
}

const marketCalls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/market'))
const lastMarketCall = (f: ReturnType<typeof vi.fn>) => new URL(marketCalls(f).at(-1)!, 'https://warren.example').searchParams
const rowTexts = (el: HTMLElement) => [...el.querySelectorAll('table tbody tr')].map((tr) => tr.textContent ?? '')
const click = async (el: Element) => { await act(async () => { (el as HTMLElement).click() }) }
const button = (scope: ParentNode, text: string) => [...scope.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text))!
const listButton = (el: HTMLElement, name: string) => button(el.querySelector('nav[aria-label="Listas"]')!, name)
const head = (el: HTMLElement, name: string) => button(el.querySelector('table thead')!, name)
const lastUrl = (spy: ReturnType<typeof vi.spyOn>) => String(spy.mock.calls.at(-1)?.[2] ?? '')

describe('MarketPage', () => {
  it('opens on the Panel líder: one page of 25 from the server, the day’s best first, in dólar MEP', async () => {
    const { el, fetchMock } = await mount()
    expect(marketCalls(fetchMock)[0]).toBe('/api/market?list=lider&page=1&size=25&sort=change%3Adesc')
    expect(rowTexts(el)[0]).toContain('GGAL')
    expect(rowTexts(el)[0]).toContain('US$ 4,00')
    expect(rowTexts(el)[0]).toContain('+3,40 %')
  })

  it('shows today’s change in money in the chosen currency', async () => {
    const { el } = await mount()
    // 6.000 pesos up 3,4 % today is 197,29 pesos, 0,13 at a MEP of 1.500.
    expect(rowTexts(el)[0]).toContain('+0,13')
  })

  it('every row links its chart and its asset page by the stored symbol, as icon buttons with a name', async () => {
    const { el } = await mount()
    const links = [...el.querySelectorAll('table tbody tr')][0].querySelectorAll('a')
    expect([...links].map((a) => a.getAttribute('href'))).toEqual(['/trading?symbol=BCBA%3AGGAL', '/activo/BCBA%3AGGAL'])
    expect([...links].map((a) => a.getAttribute('aria-label'))).toEqual(['Gráfico de GGAL', 'Ficha de GGAL'])
  })

  it('sorts from the table: Nombre A to Z then Z to A, Var. día lowest first on the second tap, each from page 1', async () => {
    const replace = vi.spyOn(window.history, 'replaceState')
    const { el, fetchMock } = await mount()
    await click(head(el, 'Nombre'))
    expect(lastMarketCall(fetchMock).get('sort')).toBe('ticker:asc')
    expect(lastUrl(replace)).toBe('/mercado?orden=ticker%3Aasc')
    await click(head(el, 'Nombre'))
    expect(lastMarketCall(fetchMock).get('sort')).toBe('ticker:desc')
    await click(head(el, 'Var. día'))
    expect(lastMarketCall(fetchMock).get('sort')).toBe('change:desc')
    await click(head(el, 'Var. día'))
    expect(lastMarketCall(fetchMock).get('sort')).toBe('change:asc')
    expect(lastMarketCall(fetchMock).get('page')).toBe('1')
  })

  it('every money column sorts too: Precio and Var. $', async () => {
    const { el, fetchMock } = await mount()
    await click(head(el, 'Precio'))
    expect(lastMarketCall(fetchMock).get('sort')).toBe('price:desc')
    await click(head(el, 'Var. $'))
    expect(lastMarketCall(fetchMock).get('sort')).toBe('abs:desc')
  })

  it('on phones the list header sorts by Nombre and Var. día the same way', async () => {
    const { el, fetchMock } = await mount()
    const phoneHead = el.querySelector('[role="group"][aria-label="Ordenar la lista"]')!
    await click(button(phoneHead, 'Nombre'))
    expect(lastMarketCall(fetchMock).get('sort')).toBe('ticker:asc')
    await click(button(phoneHead, 'Var. día'))
    expect(lastMarketCall(fetchMock).get('sort')).toBe('change:desc')
  })

  it('pages instead of a long list: page 2 from the pager, written in the URL', async () => {
    const replace = vi.spyOn(window.history, 'replaceState')
    const { el, fetchMock } = await mount()
    await click(listButton(el, 'CEDEARs'))
    expect(el.textContent).toContain('1–25 de 30')
    expect(rowTexts(el)).toHaveLength(25)
    await click(el.querySelector('nav[aria-label="Páginas"] button[aria-label="Página 2"]')!)
    expect(lastMarketCall(fetchMock).get('page')).toBe('2')
    expect(lastUrl(replace)).toBe('/mercado?lista=cedears&pagina=2')
    expect(el.textContent).toContain('26–30 de 30')
    expect(rowTexts(el)).toHaveLength(5)
  })

  it('changing the page size asks again from page 1 and keeps the size in the URL', async () => {
    const replace = vi.spyOn(window.history, 'replaceState')
    const { el, fetchMock } = await mount()
    await click(listButton(el, 'CEDEARs'))
    await click(el.querySelector('nav[aria-label="Páginas"] button[aria-label="Página 2"]')!)
    const select = el.querySelector<HTMLSelectElement>('select[aria-label="Filas por página"]')!
    await act(async () => { select.value = '50'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(lastMarketCall(fetchMock).get('size')).toBe('50')
    expect(lastMarketCall(fetchMock).get('page')).toBe('1')
    expect(lastUrl(replace)).toBe('/mercado?lista=cedears&por=50')
  })

  it('a list of the user asks the market for its symbols only, a page at a time, and says what does not trade on BYMA', async () => {
    const { el, fetchMock } = await mount()
    await click(listButton(el, 'Bancos'))
    expect(fetchMock).toHaveBeenCalledWith('/api/watchlist?watchlistId=l1&fields=symbols')
    expect(lastMarketCall(fetchMock).get('symbols')).toBe('GGAL.BA,BTCUSDT')
    const rows = rowTexts(el)
    expect(rows.some((r) => r.includes('GGAL') && r.includes('US$ 4,00'))).toBe(true)
    expect(rows.some((r) => r.includes('BTCUSDT') && r.includes('No cotiza en BYMA'))).toBe(true)
  })

  it('an empty list asks the market nothing and says it is empty', async () => {
    const { el, fetchMock } = await mount()
    const before = marketCalls(fetchMock).length
    await click(listButton(el, 'Vacía'))
    expect(marketCalls(fetchMock)).toHaveLength(before)
    expect(el.textContent).toContain('Esta lista está vacía')
  })

  it('Cartera lists the stocks held, and is counted before it is opened', async () => {
    const { el, fetchMock } = await mount()
    expect(listButton(el, 'Cartera').textContent).toBe('Cartera1')
    await click(listButton(el, 'Cartera'))
    expect(lastMarketCall(fetchMock).get('symbols')).toBe('AAPL')
    expect(rowTexts(el)[0]).toContain('AAPL')
  })

  it('the market lists show their counts from the server', async () => {
    const { el } = await mount()
    expect(listButton(el, 'Panel líder').textContent).toBe('Panel líder2')
    expect(listButton(el, 'CEDEARs').textContent).toBe('CEDEARs30')
  })

  it('on phones the lists are pills in one row', async () => {
    const { el } = await mount()
    const pills = el.querySelector('[role="group"][aria-label="Elegí una lista"]')!
    await click(button(pills, 'CEDEARs'))
    expect(button(pills, 'CEDEARs').getAttribute('aria-pressed')).toBe('true')
    expect(button(pills, 'Panel líder').getAttribute('aria-pressed')).toBe('false')
  })

  it('shows pesos when asked, and remembers the choice like the Resumen', async () => {
    const { el } = await mount()
    await click(el.querySelector<HTMLInputElement>('input[name="resumen-currency"][value="ARS"]')!)
    expect(rowTexts(el)[0]).toContain('$ 6.000,00')
    expect(localStorage.getItem('resumen:currency')).toBe('ARS')
  })

  it('the search asks the server once the typing stops, from page 1', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { el, fetchMock } = await mount()
    const input = el.querySelector<HTMLInputElement>('input[type="search"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'pampa')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(lastMarketCall(fetchMock).get('q')).toBeNull()
    await act(async () => { vi.advanceTimersByTime(400) })
    expect(lastMarketCall(fetchMock).get('q')).toBe('pampa')
    expect(lastMarketCall(fetchMock).get('page')).toBe('1')
  })

  it('a new list opens at once, and deleting the list on screen goes back to the Panel líder', async () => {
    const { el, fetchMock } = await mount()
    const nav = el.querySelector('nav[aria-label="Listas"]')!
    await click(button(nav, 'Nueva lista'))
    const input = nav.querySelector('input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Energía')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { nav.querySelector('form')!.requestSubmit() })
    expect(listButton(el, 'Energía').getAttribute('aria-current')).toBe('true')
    expect(el.textContent).toContain('Esta lista está vacía')

    await click(button(el, 'Eliminar lista'))
    await click(button(el, 'Eliminar'))
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

  it('a page opened with the market closed starts showing live prices once BYMA opens', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { el, fetchMock } = await mount({ marketOpen: false })
    expect(el.textContent).toContain('Mercado cerrado, precios al cierre.')
    const open = stub({ marketOpen: true })
    fetchMock.mockImplementation(open.getMockImplementation()!)
    await act(async () => { vi.advanceTimersByTime(5 * 60_000) })
    expect(el.textContent).toContain('Abierto')
  })
})
