// odd/tasks/chart-customization.md S3: a star per tool in the Dibujar list; the starred tools in a
// floating bar over the chart that arms them, moves by its grip, stays inside the chart, hides with a
// switch, and keeps its spot per device. S4: the stars are the account's (the chart preferences).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import type { DrawingManager } from 'lightweight-charts-drawing'
import { drag, fakeChart, pointer } from '@/lib/chart/__tests__/fake-chart'
import { selectBeforeMove } from '@/lib/chart/select-before-move'
import { touchDrawing } from '@/lib/chart/touch-drawing'
import { applyRememberedStyles } from '@/lib/chart/remembered-style'
import { SAVE_DELAY_MS, setFavorite, setToolStyle } from '@/lib/chart/preferences'
import { TOOL_KINDS } from '@/lib/chart/preferences-schema'
import { saveBar } from '@/lib/chart/favorites-bar'
import { memoryStorage } from '@/lib/chart/__tests__/memory-storage'
import { DrawingTools } from '../DrawingTools'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom lays nothing out: the chart area, the bar and the legend get their sizes here.
const area = { width: 390, height: 600 }
const BAR = { width: 46, height: 160 }
const LEGEND = { top: 8, height: 60 }
const observers: (() => void)[] = []
class FakeResizeObserver {
  constructor(private cb: () => void) { observers.push(cb) }
  observe() {}
  disconnect() { observers.splice(observers.indexOf(this.cb), 1) }
}
const resize = (width: number, height: number) => act(() => { area.width = width; area.height = height; observers.forEach(cb => cb()) })

const patches: { favorites?: Record<string, unknown> }[] = []
const cleanups: (() => void)[] = []

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      patches.push(JSON.parse(String(init.body)))
      return new Response(null, { status: 204 })
    }
    return new Response(JSON.stringify({ userId: 'u1', preferences: { favorites: {}, toolStyles: {}, indicatorSettings: {} } }))
  }))
  const size = (prop: 'width' | 'height') => function (this: HTMLElement) {
    return this.getAttribute('role') === 'toolbar' && this.getAttribute('aria-label') === 'Favoritos' ? BAR[prop] : 0
  }
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(size('width'))
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-chart-legend') ? LEGEND.height : size('height').call(this)
  })
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-chart-legend') ? LEGEND.top : 0
  })
})
afterEach(() => {
  cleanups.splice(0).forEach(c => c())
  TOOL_KINDS.forEach(kind => { setFavorite(kind, false); setToolStyle(kind, null) })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  observers.length = 0
  patches.length = 0
  area.width = 390
  area.height = 600
  document.body.innerHTML = ''
})

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const favBar = () => document.querySelector<HTMLElement>('[role="toolbar"][aria-label="Favoritos"]')
const barTools = () => [...favBar()!.querySelectorAll('button')].slice(1)
const barTool = (name: string) => barTools().find(b => b.getAttribute('aria-label') === name)!
const grip = () => favBar()!.querySelector<HTMLButtonElement>('button[aria-label="Mover la barra de favoritos"]')!
const placed = () => [favBar()!.style.left, favBar()!.style.top]
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
const phone = () => document.querySelector<HTMLElement>('[role="group"][aria-label="Dibujos"]')!
const inPhone = (name: string) => [...phone().querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? b.textContent) === name)!
const listed = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Herramientas"] button')].find(b => b.textContent?.trim() === name)!
const barSwitch = () => document.querySelector<HTMLInputElement>('input[role="switch"]')!

/** The toolbar with a real drawing layer on a fake chart (T1's finger gate and touch drawing on it),
 *  the chart box inside the container the page gives the bar, as TradingChart lays them out. */
async function render({ phoneBar = true } = {}) {
  let manager: DrawingManager | null = null
  const chart = fakeChart(el => cleanups.push(selectBeforeMove(el, () => manager)))
  manager = chart.manager
  cleanups.push(touchDrawing(chart.manager, chart.el))
  const chartArea = document.createElement('div')
  Object.defineProperties(chartArea, {
    clientWidth: { get: () => area.width, configurable: true },
    clientHeight: { get: () => area.height, configurable: true },
  })
  const legend = document.createElement('div')
  legend.setAttribute('data-chart-legend', '')
  chartArea.append(chart.el, legend)
  const bottomBar = document.createElement('div')
  const host = document.createElement('div')
  document.body.append(host, chartArea, bottomBar)
  const onAlertMode = vi.fn()
  const root = createRoot(host)
  await act(async () => {
    root.render(<DrawingTools manager={chart.manager} alertMode={false} onAlertMode={onAlertMode} phoneBar={phoneBar ? bottomBar : null} chartArea={chartArea} />)
  })
  const openTools = async () => { act(() => inPhone('Dibujar').click()); await flush() }
  return { ...chart, chartArea, onAlertMode, openTools, unmount: () => act(() => root.unmount()) }
}

describe('the star in the Dibujar list', () => {
  it('on a phone, inside the list in the bottom bar, stars a tool in the account without arming it', async () => {
    const { manager, openTools, unmount } = await render()
    await openTools()

    act(() => button('Agregar Canal paralelo a favoritos').click())

    expect(button('Sacar Canal paralelo de favoritos').getAttribute('aria-pressed')).toBe('true')
    expect(manager.tool()).toBeNull()
    expect(document.querySelector('[aria-label="Herramientas"]')).not.toBeNull()
    await act(async () => { await new Promise(r => setTimeout(r, SAVE_DELAY_MS + 100)) })
    expect(patches.some(p => p.favorites?.['parallel-channel'] === true)).toBe(true)

    act(() => button('Sacar Canal paralelo de favoritos').click())
    expect(button('Agregar Canal paralelo a favoritos').getAttribute('aria-pressed')).toBe('false')
    unmount()
  })

  it("on a phone, the tool's name still arms it and closes the list", async () => {
    const { manager, openTools, unmount } = await render()
    await openTools()

    act(() => listed('Canal paralelo').click())

    expect(manager.tool()).toBe('parallel-channel')
    expect(document.querySelector('[aria-label="Herramientas"]')).toBeNull()
    unmount()
  })

  it('on a computer, the list opens from the toolbar, stars without arming and arms by name', async () => {
    const { manager, unmount } = await render({ phoneBar: false })
    act(() => button('Más').click())
    await flush()
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Más"] button')].find(b => b.textContent === 'Elegir favoritos')!.click())
    await flush()

    act(() => button('Agregar Rectángulo a favoritos').click())
    expect(manager.tool()).toBeNull()
    expect(barTools().map(b => b.getAttribute('aria-label'))).toEqual(['Rectángulo'])

    act(() => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Elegir favoritos"] button')].find(b => b.textContent?.trim() === 'Texto')!.click())
    await flush()
    expect(manager.tool()).toBe('text')
    unmount()
  })
})

describe('the favorites bar', () => {
  it('shows the starred tools in the order of the Dibujar list, and is not there without any', async () => {
    const { unmount } = await render()
    expect(favBar()).toBeNull()

    act(() => { setFavorite('rectangle', true); setFavorite('trend-line', true); setFavorite('fib-retracement', true) })
    expect(barTools().map(b => b.getAttribute('aria-label'))).toEqual(['Línea de tendencia', 'Retroceso de Fibonacci', 'Rectángulo'])

    act(() => { setFavorite('rectangle', false); setFavorite('trend-line', false); setFavorite('fib-retracement', false) })
    expect(favBar()).toBeNull()
    unmount()
  })

  it('floats over the chart, in its container, and takes no room of its own', async () => {
    setFavorite('trend-line', true)
    const { chartArea, unmount } = await render()

    expect(favBar()!.parentElement).toBe(chartArea)
    expect(favBar()!.className).toMatch(/\babsolute\b/)
    unmount()
  })

  it('arms a tool as the list does: active in the bar, what to do and Cancelar in the bottom bar', async () => {
    setFavorite('parallel-channel', true)
    const { manager, onAlertMode, unmount } = await render()

    act(() => barTool('Canal paralelo').click())
    expect(manager.tool()).toBe('parallel-channel')
    expect(onAlertMode).toHaveBeenCalledWith(false)
    expect(barTool('Canal paralelo').getAttribute('aria-pressed')).toBe('true')
    expect(phone().textContent).toContain('Arrastrá y después tocá el tercer punto')

    act(() => inPhone('Cancelar').click())
    expect(manager.tool()).toBeNull()
    expect(barTool('Canal paralelo').getAttribute('aria-pressed')).toBe('false')

    act(() => barTool('Canal paralelo').click())
    act(() => barTool('Canal paralelo').click())
    expect(manager.tool()).toBeNull()
    unmount()
  })

  it('a tool armed from it draws with a finger (the select-before-move gate steps aside) in its remembered style', async () => {
    cleanups.push(applyRememberedStyles())
    setToolStyle('trend-line', { color: '#f23645' })
    setFavorite('trend-line', true)
    const { el, manager, unmount } = await render()

    act(() => barTool('Línea de tendencia').click())
    act(() => drag(el, [100, 150], [200, 120]))

    expect(manager.drawings()).toHaveLength(1)
    expect(manager.drawings()[0].style.color).toBe('#f23645')
    unmount()
  })

  it('starts at the top-left, under the legend', async () => {
    setFavorite('trend-line', true)
    const { unmount } = await render()

    expect(placed()).toEqual(['8px', `${LEGEND.top + LEGEND.height + 8}px`])
    unmount()
  })

  it('moves by its grip without the press reaching the chart, and is found there on the next visit', async () => {
    setFavorite('trend-line', true)
    const { el, manager, applied, chartArea, unmount } = await render()
    const reached = vi.fn()
    el.addEventListener('pointerdown', reached, true)
    el.addEventListener('pointermove', reached, true)
    const [left, top] = placed().map(parseFloat)

    act(() => pointer(grip(), 'pointerdown', 20, 100))
    act(() => pointer(grip(), 'pointermove', 120, 250))
    act(() => pointer(grip(), 'pointerup', 120, 250))

    const moved = [`${left + 100}px`, `${top + 150}px`]
    expect(placed()).toEqual(moved)
    expect(reached).not.toHaveBeenCalled()
    expect(manager.drawings()).toEqual([])
    expect(manager.selection()).toEqual([])
    expect(applied.some(o => (o as { handleScroll?: unknown }).handleScroll === false)).toBe(false)
    // The browser leaves a finger on the grip to the bar: no page scroll or zoom takes it over.
    expect(grip().className).toMatch(/\btouch-none\b/)
    expect(chartArea.contains(favBar())).toBe(true)

    unmount()
    await render()
    expect(placed()).toEqual(moved)
  })

  it('moves with the arrow keys from its grip, kept inside the chart and on the device', async () => {
    setFavorite('trend-line', true)
    const { unmount } = await render()
    const [left, top] = placed().map(parseFloat)
    const key = (k: string) => act(() => { grip().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })) })

    key('ArrowRight')
    key('ArrowDown')
    key('ArrowLeft')
    key('ArrowLeft')
    expect(placed()).toEqual(['4px', `${top + 16}px`])

    unmount()
    await render()
    expect(placed()).toEqual(['4px', `${top + 16}px`])
    expect(left).toBe(8)
  })

  it('a saved spot outside the chart is brought inside, and again when the chart resizes or turns', async () => {
    saveBar({ position: { x: 5000, y: -40 } })
    setFavorite('trend-line', true)
    const { unmount } = await render()

    expect(placed()).toEqual([`${390 - 46 - 4}px`, '4px'])

    resize(300, 400)
    expect(placed()).toEqual([`${300 - 46 - 4}px`, '4px'])

    saveBar({ position: { x: 200, y: 500 } })
    unmount()
    await render()
    expect(placed()).toEqual(['200px', `${400 - 160 - 4}px`])
    resize(390, 800)
    expect(placed()).toEqual(['200px', '500px'])
  })

  it('hides and shows with the Barra de favoritos switch, kept on this device', async () => {
    setFavorite('trend-line', true)
    const first = await render()
    await first.openTools()
    expect(barSwitch().checked).toBe(true)
    expect(barSwitch().closest('label')!.textContent).toContain('Barra de favoritos')

    act(() => barSwitch().click())
    expect(favBar()).toBeNull()
    expect(barSwitch().checked).toBe(false)

    first.unmount()
    document.body.innerHTML = ''
    const second = await render()
    expect(favBar()).toBeNull()
    await second.openTools()
    expect(barSwitch().checked).toBe(false)

    act(() => barSwitch().click())
    expect(favBar()).not.toBeNull()
    second.unmount()
  })
})
