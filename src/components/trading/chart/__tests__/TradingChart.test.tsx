import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { createChart } from 'lightweight-charts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// lightweight-charts draws on canvas, which jsdom lacks: a recording stand-in.
const priceScale = { applyOptions: vi.fn() }
const series = {
  priceScale: () => priceScale,
  applyOptions: vi.fn(),
  setData: vi.fn(),
  update: vi.fn(),
  createPriceLine: vi.fn(() => ({ applyOptions: vi.fn() })),
  removePriceLine: vi.fn(),
  coordinateToPrice: vi.fn((y: number) => 100 - y / 10),
  priceToCoordinate: vi.fn(() => null),
}
const chart = {
  addSeries: vi.fn(() => series),
  applyOptions: vi.fn(),
  subscribeCrosshairMove: vi.fn(),
  unsubscribeCrosshairMove: vi.fn(),
  timeScale: () => ({ setVisibleLogicalRange: vi.fn() }),
  panes: vi.fn(() => []),
  removeSeries: vi.fn(),
  remove: vi.fn(),
  chartElement: () => document.createElement('div'),
}
vi.mock('lightweight-charts', () => ({
  createChart: vi.fn(() => chart),
  CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {},
  CrosshairMode: { Normal: 0 }, LineStyle: { Solid: 0, Dashed: 2 },
  TickMarkType: { Year: 0, Month: 1, DayOfMonth: 2, Time: 3, TimeWithSeconds: 4 },
}))
// The drawing layer's events, so a test can raise them.
const drawingEvents: Record<string, (...a: unknown[]) => void> = {}
vi.mock('lightweight-charts-drawing', () => ({
  DrawingManager: class {
    on(event: string, cb: (...a: unknown[]) => void) { drawingEvents[event] = cb; return () => {} }
    tool() { return null }
    setInterval() {}
    destroy() {}
  },
}))

const candle = { time: 1, open: 1, high: 2, low: 0.5, close: 1.5 }
vi.mock('../useCandles', () => ({
  useCandles: () => ({ status: 'ready', candles: [candle], change: { kind: 'set' }, retry: () => {} }),
}))
vi.mock('../useDrawings', () => ({ useDrawings: () => 'ready' }))
const alertsApi = { alerts: [] as unknown[], create: vi.fn(), move: vi.fn(), rearm: vi.fn(), remove: vi.fn() }
vi.mock('../useChartAlerts', () => ({ useChartAlerts: () => alertsApi }))
vi.mock('../useChartTheme', () => ({
  useChartTheme: () => ({ bg: '#fff', ink: '#000', ink2: '#111', ink3: '#222', line: '#ddd', lineStrong: '#ccc', accent: '#0a0', up: '#0f0', down: '#f00', font: 'sans' }),
}))
// The toolbar has its own tests; here it only switches the alert mode on.
vi.mock('../DrawingTools', () => ({
  DrawingTools: ({ onAlertMode }: { onAlertMode: (on: boolean) => void }) => (
    <button type="button" onClick={() => onAlertMode(true)}>Alerta</button>
  ),
}))

const { TradingChart } = await import('../TradingChart')

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); alertsApi.alerts = []; series.priceToCoordinate.mockReturnValue(null); document.body.innerHTML = '' })

const onPhone = (phone: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: phone && q.includes('max-width'), media: q, addEventListener() {}, removeEventListener() {} }))
const panes = (n: number) => Array.from({ length: n }, () => ({ setStretchFactor: vi.fn() }))
// jsdom has no matchMedia: a desktop unless a test says otherwise.
beforeEach(() => onPhone(false))
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent === text)!

async function render(symbol = 'BTCUSDT') {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<TradingChart symbol={symbol} timeframe="1d" />) })
  // The element the chart is created in.
  const box = vi.mocked(createChart).mock.calls[0][0] as HTMLElement
  return { box, unmount: () => act(() => root.unmount()) }
}

describe('TradingChart on a touch screen', () => {
  it('keeps every touch gesture for the chart, so the browser never cancels a drag halfway (S1)', async () => {
    const { box, unmount } = await render()

    expect(box.classList).toContain('touch-none')
    unmount()
  })
})

describe('TradingChart price scale', () => {
  // A finger dragged on the price axis turns the chart's auto scale off (checked on the
  // real library): without a reset, SPY opened inside the range BTC left behind.
  it('a new ticker fits its own prices, even after the price axis was scaled by hand', async () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => { root.render(<TradingChart symbol="BTCUSDT" timeframe="1d" />) })
    priceScale.applyOptions.mockClear()

    await act(async () => { root.render(<TradingChart symbol="SPY" timeframe="1d" />) })

    expect(priceScale.applyOptions).toHaveBeenCalledWith({ autoScale: true })
    act(() => root.unmount())
  })

  it('a reload of the same ticker keeps the scale the user chose', async () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => { root.render(<TradingChart symbol="SPY" timeframe="1d" />) })
    priceScale.applyOptions.mockClear()
    series.setData.mockClear()

    await act(async () => { root.render(<TradingChart symbol="SPY" timeframe="1d" />) })

    expect(series.setData).toHaveBeenCalled()
    expect(priceScale.applyOptions).not.toHaveBeenCalled()
    act(() => root.unmount())
  })
})

describe('TradingChart text editor', () => {
  it('stays inside the chart when the text sits near the right edge of a phone (S3)', async () => {
    const { box, unmount } = await render()
    Object.defineProperty(box, 'clientWidth', { value: 390 })

    await act(async () => { drawingEvents.textEdit({ id: 't', kind: 'text', text: 'Soporte' }, { x: 380, y: 120 }) })

    const input = document.querySelector<HTMLInputElement>('input[aria-label="Texto del dibujo"]')!
    expect(input.value).toBe('Soporte')
    expect(input.style.left).toBe('158px') // 390 wide, a 224px editor, 8px from the edge
    expect(input.classList).toContain('max-w-[calc(100%-16px)]')
    unmount()
  })
})

describe('TradingChart price pane on a phone (S6)', () => {
  it('keeps two thirds of the height for the price with five indicator panes', async () => {
    onPhone(true)
    const list = panes(6)
    chart.panes.mockReturnValue(list as never)

    const { unmount } = await render()

    expect(list[0].setStretchFactor).toHaveBeenLastCalledWith(10)
    list.slice(1).forEach(p => expect(p.setStretchFactor).toHaveBeenLastCalledWith(1))
    unmount()
  })

  it('a desktop keeps the panes as they were', async () => {
    onPhone(false)
    const list = panes(6)
    chart.panes.mockReturnValue(list as never)

    const { unmount } = await render()

    expect(list[0].setStretchFactor).toHaveBeenLastCalledWith(6)
    unmount()
  })
})

// odd/tasks/grafico-espacio.md S5: the panes are only sized when the indicators change, so the
// heights a finger set stay from one symbol to the next.
describe('TradingChart pane heights', () => {
  it('a new symbol keeps the heights the user set', async () => {
    onPhone(true)
    const list = panes(3)
    chart.panes.mockReturnValue(list as never)
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => { root.render(<TradingChart symbol="BTCUSDT" timeframe="1d" />) })
    expect(list[0].setStretchFactor).toHaveBeenCalled()
    list.forEach(p => p.setStretchFactor.mockClear())

    await act(async () => { root.render(<TradingChart symbol="SPY" timeframe="1w" />) })

    list.forEach(p => expect(p.setStretchFactor).not.toHaveBeenCalled())
    act(() => root.unmount())
  })

  it('marks its box for the wider pane separators on touch screens', async () => {
    const { box, unmount } = await render()
    expect(box.hasAttribute('data-chart-box')).toBe(true)
    unmount()
  })

  // The separators' z-index 50 drew their grab pills over the open app menu (seen in Chromium).
  // A phone only: on a computer the menu is a column, and isolating changed its text rendering.
  it("keeps the separators under the phone's app menu", async () => {
    const { box, unmount } = await render()
    expect(box.classList).toContain('max-[819px]:isolate')
    expect(box.classList).not.toContain('isolate')
    unmount()
  })

  // globals.css widens the separator by its place in the library's DOM (inline styles, no class),
  // checked on 5.2.0 with a finger in Chromium: another version has to be checked again.
  it("the separator override matches the library's DOM", async () => {
    const { readFileSync } = await import('node:fs')
    const lib = 'node_modules/lightweight-charts'
    expect(JSON.parse(readFileSync(`${lib}/package.json`, 'utf8')).version).toBe('5.2.0')
    const bundle = readFileSync(`${lib}/dist/lightweight-charts.production.mjs`, 'utf8')
    expect(bundle).toContain('setAttribute("colspan","3")')
    expect(bundle).toMatch(/cursor="row-resize",this\.\w+\.appendChild\(\w\);const \w=document\.createElement\("div"\),\w=\w\.style;\w\.position="absolute",\w\.zIndex="50",\w\.top="-4px",\w\.height="9px"/)
  })
})

describe('TradingChart price alerts (S7)', () => {
  async function placeAlertAt(price: number) {
    const { box, unmount } = await render()
    act(() => button('Alerta').click())
    series.coordinateToPrice.mockReturnValueOnce(price)
    act(() => { box.dispatchEvent(new PointerEvent('pointerdown', { clientY: 50, bubbles: true })) })
    return unmount
  }

  it('a coin under 1 keeps the four decimals the chart shows', async () => {
    const unmount = await placeAlertAt(0.123456)

    expect(alertsApi.create).toHaveBeenCalledWith(0.1235)
    unmount()
  })

  it('a price over 1 keeps two decimals', async () => {
    const unmount = await placeAlertAt(80513.2849)

    expect(alertsApi.create).toHaveBeenCalledWith(80513.28)
    unmount()
  })
})

describe('TradingChart alert lines under a finger (S4)', () => {
  async function pressNearAlert(pointerType: string) {
    alertsApi.alerts = [{ id: 'a1', ticker: 'BTCUSDT', operator: 'crosses_above', value: 90000, name: 'BTCUSDT cruza por encima de 90.000', status: 'active' }]
    series.priceToCoordinate.mockReturnValue(100 as never)
    const { box, unmount } = await render()
    act(() => {
      box.dispatchEvent(new PointerEvent('pointerdown', { clientY: 112, pointerType, bubbles: true }))
      window.dispatchEvent(new PointerEvent('pointerup', { clientY: 112, pointerType }))
    })
    await act(async () => {})
    return { dialog: document.querySelector('[role="dialog"][aria-label="BTCUSDT cruza por encima de 90.000"]'), unmount }
  }

  it('a finger 12px off the line opens its actions', async () => {
    const { dialog, unmount } = await pressNearAlert('touch')

    expect(dialog).not.toBeNull()
    unmount()
  })

  it('the actions open above the line, clear of it, so the line can still be dragged', async () => {
    const { dialog, unmount } = await pressNearAlert('touch')

    // pressed at y 112: the panel (up to ~62px with a wrapped name) ends 10px above
    expect((dialog as HTMLElement).style.top).toBe('40px')
    unmount()
  })

  it('the mouse keeps its precision: 12px off misses the line', async () => {
    const { dialog, unmount } = await pressNearAlert('mouse')

    expect(dialog).toBeNull()
    unmount()
  })
})

describe('TradingChart text editor after placing a text (S3)', () => {
  const editor = () => document.querySelector<HTMLInputElement>('input[aria-label="Texto del dibujo"]')

  it('with a finger it opens when the finger lifts, focused, so the chart cannot take the focus away', async () => {
    const { box, unmount } = await render()

    act(() => { box.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true })) })
    await act(async () => { drawingEvents.textEdit({ id: 't', kind: 'text', text: '' }, { x: 40, y: 120 }) })
    expect(editor()).toBeNull()

    const lift = new Event('touchend', { cancelable: true })
    act(() => { window.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch' })); window.dispatchEvent(lift) })

    expect(editor()).not.toBeNull()
    expect(document.activeElement).toBe(editor())
    expect(lift.defaultPrevented).toBe(true) // no emulated mouse press follows to blur it
    unmount()
  })

  it('a cancelled touch still opens it, and leaves no listener to swallow the next tap', async () => {
    const { box, unmount } = await render()

    act(() => { box.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true })) })
    await act(async () => { drawingEvents.textEdit({ id: 't', kind: 'text', text: '' }, { x: 40, y: 120 }) })
    act(() => { window.dispatchEvent(new Event('touchcancel')) })
    expect(editor()).not.toBeNull()

    const nextTap = new Event('touchend', { cancelable: true })
    act(() => { window.dispatchEvent(nextTap) })
    expect(nextTap.defaultPrevented).toBe(false)
    unmount()
  })

  it('with the mouse it opens when the button is released', async () => {
    const { box, unmount } = await render()

    act(() => { box.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', bubbles: true })) })
    await act(async () => { drawingEvents.textEdit({ id: 't', kind: 'text', text: '' }, { x: 40, y: 120 }) })
    expect(editor()).toBeNull()
    act(() => { window.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'mouse' })) })

    expect(document.activeElement).toBe(editor())
    unmount()
  })
})
