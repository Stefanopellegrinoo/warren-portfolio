import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { RightSidebar } from '../RightSidebar'
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

// "Tu posición" has its own tests; here it only has to be there.
vi.mock('@/components/trading/sidebar/PnLSidebar', () => ({ PnLSidebar: () => <section data-pnl /> }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const WIDTH_KEY = 'warren:watchlist-width'
// jsdom has no layout and no matchMedia: each test says how wide the window and the chart row are.
const atWindow = (wide: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: wide && q.includes('min-width: 1100px'), media: q, addEventListener() {}, removeEventListener() {} }))
// What the list takes on screen, as the browser's ResizeObserver reports it (0 while hidden behind the chart).
// With a ResizeObserver the list's ScrollArea also asks for getAnimations, which jsdom lacks: none run here.
const measured = (width: number) => {
  vi.stubGlobal('ResizeObserver', class {
    constructor(private report: ResizeObserverCallback) {}
    observe() { this.report([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
    disconnect() {}
  })
  Element.prototype.getAnimations = () => []
}
// A month of rising daily bars.
const month = Array.from({ length: 24 }, (_, i) => ({ time: `2026-09-${String(i + 1).padStart(2, '0')}`, open: 1, high: 1, low: 1, close: 100 + i }))

let urls: string[]
beforeEach(() => {
  localStorage.clear()
  forgetCached()
  Element.prototype.setPointerCapture = vi.fn()
  useChartStore.setState({ symbol: 'AAPL', activeWatchlistId: null, watchlist: ['AAPL'] })
  urls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url)
    if (url === '/api/watchlist/lists') return Response.json({ lists: [] })
    if (url.startsWith('/api/ticker/search')) return Response.json({ results: [{ symbol: 'AAPL', shortname: 'Apple Inc.', exchange: 'NMS' }] })
    if (url.startsWith('/api/klines')) return Response.json(month)
    return Response.json([])
  }))
  atWindow(true)
})
afterEach(() => {
  vi.unstubAllGlobals()
  // jsdom has neither: put it back as it was.
  delete (Element.prototype as Partial<Element>).setPointerCapture
  delete (Element.prototype as Partial<Element>).getAnimations
  document.body.innerHTML = ''
})

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

async function render(rowWidth = 1400) {
  const row = document.createElement('div')
  Object.defineProperty(row, 'clientWidth', { configurable: true, value: rowWidth })
  document.body.appendChild(row)
  const root = createRoot(row)
  await act(async () => { root.render(<RightSidebar price={null} />) })
  await flush()
  const aside = () => row.querySelector('aside')!
  const handle = () => row.querySelector<HTMLElement>('[role="separator"]')
  return { row, aside, handle, unmount: () => act(() => root.unmount()) }
}

const pointer = (el: Element, type: string, clientX: number) =>
  act(() => { el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX, pointerId: 1 })) })
async function drag(el: Element, from: number, to: number) {
  pointer(el, 'pointerdown', from)
  pointer(el, 'pointermove', to)
  pointer(el, 'pointerup', to)
  await flush()
}
const key = (el: Element, k: string) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })) })

describe('RightSidebar — the list is resized by dragging its left edge (from 1100 px)', () => {
  it('starts at 280 px with a focusable vertical separator that says its width and limits', async () => {
    const { aside, handle, unmount } = await render()

    expect(aside().style.width).toBe('280px')
    expect(handle()!.getAttribute('aria-orientation')).toBe('vertical')
    expect(handle()!.tabIndex).toBe(0)
    expect(handle()!.getAttribute('aria-valuenow')).toBe('280')
    expect(handle()!.getAttribute('aria-valuemin')).toBe('220')
    expect(handle()!.getAttribute('aria-valuemax')).toBe('640')
    expect(handle()!.className).toContain('cursor-col-resize')
    expect(handle()!.className).toContain('touch-none')
    unmount()
  })

  it('dragging left widens the list by what the pointer moved, capturing the pointer', async () => {
    const { aside, handle, unmount } = await render()

    await drag(handle()!, 1000, 900)

    expect(aside().style.width).toBe('380px')
    expect(handle()!.getAttribute('aria-valuenow')).toBe('380')
    expect(Element.prototype.setPointerCapture).toHaveBeenCalledWith(1)
    unmount()
  })

  it('never narrower than 220 px nor wider than 640 px', async () => {
    const { aside, handle, unmount } = await render()

    await drag(handle()!, 1000, 1500)
    expect(aside().style.width).toBe('220px')

    await drag(handle()!, 1000, 0)
    expect(aside().style.width).toBe('640px')
    unmount()
  })

  it('never leaves the chart under 420 px next to the drawing rail, whatever the app menu takes', async () => {
    // A 900 px row (the window minus the menu) leaves 900 − 420 − 48 = 432 px for the list.
    const { aside, handle, unmount } = await render(900)

    await drag(handle()!, 1000, 0)

    expect(aside().style.width).toBe('432px')
    expect(handle()!.getAttribute('aria-valuemax')).toBe('432')
    // And the CSS keeps it so when the menu or the window changes after the drag.
    expect(aside().style.maxWidth).toBe('calc(100% - 468px)')
    unmount()
  })

  it('the arrow keys move the edge 16 px: left widens, right narrows, within the same limits', async () => {
    const { aside, handle, unmount } = await render()

    key(handle()!, 'ArrowLeft')
    expect(aside().style.width).toBe('296px')
    key(handle()!, 'ArrowRight')
    key(handle()!, 'ArrowRight')
    expect(aside().style.width).toBe('264px')
    for (let i = 0; i < 10; i++) key(handle()!, 'ArrowRight')
    expect(aside().style.width).toBe('220px')
    unmount()
  })

  it('the width is remembered on this device and comes back on the next visit', async () => {
    const first = await render()
    await drag(first.handle()!, 1000, 850)
    expect(localStorage.getItem(WIDTH_KEY)).toBe('430')
    first.unmount()

    const again = await render()
    expect(again.aside().style.width).toBe('430px')
    again.unmount()
  })

  it('a broken or out-of-range remembered width falls back to 280 px', async () => {
    localStorage.setItem(WIDTH_KEY, 'wide')
    const { aside, unmount } = await render()

    expect(aside().style.width).toBe('280px')
    unmount()
  })

  it('a double click goes back to 280 px, and that is remembered too', async () => {
    const { aside, handle, unmount } = await render()
    await drag(handle()!, 1000, 700)

    act(() => { handle()!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })

    expect(aside().style.width).toBe('280px')
    expect(localStorage.getItem(WIDTH_KEY)).toBe('280')
    unmount()
  })

  it('a wider list shows the asset name, fetched only once it is that wide', async () => {
    const { row, handle, unmount } = await render()
    expect(urls.some(u => u.startsWith('/api/ticker/search') || u.startsWith('/api/klines'))).toBe(false)
    expect(row.textContent).not.toContain('Apple Inc.')

    await drag(handle()!, 1000, 900)

    expect(urls).toContain('/api/ticker/search?q=AAPL')
    expect(row.textContent).toContain('Apple Inc.')
    unmount()
  })

  it('keeps the list and "Tu posición"', async () => {
    const { row, unmount } = await render()

    expect(row.querySelector('ul[aria-label="Símbolos de la lista"]')!.textContent).toContain('AAPL')
    expect(row.querySelector('[data-pnl]')).not.toBeNull()
    unmount()
  })
})

describe('RightSidebar — below 1100 px the list is full width in its own view', () => {
  beforeEach(() => atWindow(false))
  const extraRequests = () => urls.filter(u => u.startsWith('/api/ticker/search') || u.startsWith('/api/klines'))

  it('has no handle and no set width, even with a wide width remembered', async () => {
    localStorage.setItem(WIDTH_KEY, '600')
    measured(390)
    const { aside, handle, unmount } = await render()

    expect(handle()).toBeNull()
    expect(aside().style.width).toBe('')
    expect(aside().style.maxWidth).toBe('')
    expect(aside().className).toContain('w-[280px]')
    expect(aside().className).toContain('max-[1099px]:w-full')
    unmount()
  })

  it('hidden behind the chart (0 px wide) it asks for no name and no line', async () => {
    measured(0)
    const { row, unmount } = await render()

    expect(extraRequests()).toEqual([])
    expect(row.textContent).not.toContain('Apple Inc.')
    expect(row.querySelector('svg polyline')).toBeNull()
    unmount()
  })

  it('on a phone (390 px) the list shows each name and no line', async () => {
    measured(390)
    const { row, unmount } = await render()

    expect(urls).toContain('/api/ticker/search?q=AAPL')
    expect(row.textContent).toContain('Apple Inc.')
    expect(urls.some(u => u.startsWith('/api/klines'))).toBe(false)
    expect(row.querySelector('svg polyline')).toBeNull()
    unmount()
  })

  it('on a tablet (900 px) the list shows each name and its one-month line', async () => {
    measured(900)
    const { row, unmount } = await render()

    expect(row.textContent).toContain('Apple Inc.')
    expect(row.textContent).toContain('1 mes')
    expect(urls).toContain('/api/klines?ticker=AAPL&interval=1d&days=35')
    expect(row.querySelector('svg polyline')).not.toBeNull()
    unmount()
  })
})
