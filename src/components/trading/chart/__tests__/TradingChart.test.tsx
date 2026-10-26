import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { createChart } from 'lightweight-charts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Node 25 ships a stub localStorage without methods; the persisted chart store needs a real one.
vi.hoisted(() => {
  const data = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) },
  })
})

// lightweight-charts draws on canvas, which jsdom lacks: a recording stand-in.
// The visible time range, which the library applies lazily after a range is set.
const getVisibleRange = vi.fn((): { from: number; to: number } | null => null)
// Every logical range the chart asked to show (its fit on load, a comparison's range).
const setVisibleLogicalRange = vi.fn()
const priceScale = { applyOptions: vi.fn() }
const series = {
  priceScale: () => priceScale,
  applyOptions: vi.fn(),
  setData: vi.fn(),
  update: vi.fn(),
  createPriceLine: vi.fn(() => ({ applyOptions: vi.fn() })),
  removePriceLine: vi.fn(),
  attachPrimitive: vi.fn(),
  coordinateToPrice: vi.fn((y: number) => 100 - y / 10),
  priceToCoordinate: vi.fn(() => null),
}
const chart = {
  addSeries: vi.fn(() => series),
  applyOptions: vi.fn(),
  subscribeCrosshairMove: vi.fn(),
  unsubscribeCrosshairMove: vi.fn(),
  // A bar's x is its time, for the trade card's finger slop.
  timeScale: () => ({ setVisibleLogicalRange, timeToCoordinate: (t: number) => t, subscribeVisibleTimeRangeChange: vi.fn(), unsubscribeVisibleTimeRangeChange: vi.fn(), getVisibleRange }),
  subscribeClick: vi.fn(),
  unsubscribeClick: vi.fn(),
  panes: vi.fn(() => []),
  removeSeries: vi.fn(),
  remove: vi.fn(),
  chartElement: () => document.createElement('div'),
}
// The trade arrows the chart last set on the candles.
const markers = { setMarkers: vi.fn() }
vi.mock('lightweight-charts', () => ({
  createChart: vi.fn(() => chart),
  createSeriesMarkers: vi.fn(() => markers),
  CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {},
  CrosshairMode: { Normal: 0 }, LineStyle: { Solid: 0, Dashed: 2 }, PriceScaleMode: { Normal: 0, Logarithmic: 1, Percentage: 2, IndexedTo100: 3 },
  TickMarkType: { Year: 0, Month: 1, DayOfMonth: 2, Time: 3, TimeWithSeconds: 4 },
}))
// The drawing layer's events, so a test can raise them.
const drawingEvents: Record<string, (...a: unknown[]) => void> = {}
const drawingSelect = vi.fn()
const drawingSetTool = vi.fn()
const drawingsVisible = vi.fn()
// What the drawing layer holds: the armed tool and the selected drawings.
const drawingState = { tool: null as string | null, selection: [] as string[] }
// What the chart set up, in order.
const setupOrder: string[] = []
vi.mock('lightweight-charts-drawing', () => ({
  DrawingManager: class {
    constructor() { setupOrder.push('drawing layer') }
    on(event: string, cb: (...a: unknown[]) => void) { drawingEvents[event] = cb; return () => {} }
    tool() { return drawingState.tool }
    selection() { return drawingState.selection }
    setTool(kind: string | null) { drawingSetTool(kind) }
    select(ids: string[]) { drawingSelect(ids) }
    setInterval() {}
    setDrawingsVisible(v: boolean) { drawingsVisible(v) }
    destroy() {}
  },
  setDefaultStyleOverride: vi.fn(),
}))
vi.mock('@/lib/chart/select-before-move', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/chart/select-before-move')>()
  return { ...real, selectBeforeMove: (...a: Parameters<typeof real.selectBeforeMove>) => { setupOrder.push('select before move'); return real.selectBeforeMove(...a) } }
})

const candle = { time: 1, open: 1, high: 2, low: 0.5, close: 1.5 }
const bars = { candles: [candle] as typeof candle[], status: 'ready', error: undefined as string | undefined, key: undefined as string | undefined }
vi.mock('../useCandles', () => ({
  useCandles: (symbol: string, timeframe: string) => ({ status: bars.status, candles: bars.candles, error: bars.error, change: { kind: 'set' }, retry: () => {}, key: bars.key ?? `${symbol}:${timeframe}` }),
}))
vi.mock('../useDrawings', () => ({ useDrawings: () => 'ready' }))
// The compared series the chart is given: a test sets what the endpoint answered.
const compare = { status: 'idle' as string, series: {} as Record<string, unknown>, ccl: undefined as unknown }
const useCompareSeries = vi.fn((_symbols: string[], _ccl: boolean) => compare)
vi.mock('../useCompareSeries', () => ({ useCompareSeries: (s: string[], c: boolean) => useCompareSeries(s, c) }))
// What useChartAlerts gives an alert from before the conditions: the price against its value, no color.
const PRICE_VALUE = { source: 'price', target: 'value', timeframe: null, periods: null, color: null }
const alertsApi = { alerts: [] as unknown[], create: vi.fn(), save: vi.fn(async () => true), move: vi.fn(), rearm: vi.fn(), remove: vi.fn() }
vi.mock('../useChartAlerts', () => ({ useChartAlerts: () => alertsApi }))
vi.mock('../useChartTheme', () => ({
  useChartTheme: () => ({ bg: '#fff', ink: '#000', ink2: '#111', ink3: '#222', line: '#ddd', lineStrong: '#ccc', accent: '#0a0', up: '#0f0', down: '#f00', font: 'sans' }),
}))
// The toolbar has its own tests; here it only switches the alert mode on, and shows where the
// chart lets it float the favorites bar.
let favoritesArea: HTMLElement | null | undefined
// What the chart handed the toolbar: its drawing layer (null while drawing is paused) and the alerts switch.
const toolbar = { manager: undefined as unknown, alertsOff: undefined as boolean | undefined }
vi.mock('../DrawingTools', () => ({
  DrawingTools: ({ manager, alertsOff, onAlertMode, chartArea, alerts, onNewAlert, onOpenAlert }: { manager: unknown; alertsOff?: boolean; onAlertMode: (on: boolean) => void; chartArea?: HTMLElement | null; alerts?: { id: string }[]; onNewAlert?: () => void; onOpenAlert?: (id: string) => void }) => {
    favoritesArea = chartArea
    toolbar.manager = manager
    toolbar.alertsOff = alertsOff
    return (
      <>
        <button type="button" onClick={() => onAlertMode(true)}>Alerta</button>
        <button type="button" onClick={() => onNewAlert?.()}>Nueva alerta…</button>
        {alerts?.map((a) => <button key={a.id} type="button" onClick={() => onOpenAlert?.(a.id)}>{`abrir ${a.id}`}</button>)}
      </>
    )
  },
}))

const { TradingChart } = await import('../TradingChart')
const { setDefaultStyleOverride } = await import('lightweight-charts-drawing')
const { setToolStyle, setIndicatorSettings } = await import('@/lib/chart/preferences')
const { useChartStore, DEFAULT_CONFIG } = await import('@/lib/store/chart-store')
const DEFAULT_INDICATORS = { ...useChartStore.getState().indicators }
const { INDICATOR_KEYS } = await import('@/lib/chart/preferences-schema')
const lwc = await import('lightweight-charts')

afterEach(() => { compare.status = 'idle'; compare.series = {}; compare.ccl = undefined; bars.status = 'ready'; bars.error = undefined; bars.key = undefined; getVisibleRange.mockReset(); getVisibleRange.mockReturnValue(null); useChartStore.setState({ compareSymbols: [], compareDefaulted: true, compareRange: '1A', indicators: { ...DEFAULT_INDICATORS } }); vi.clearAllMocks(); vi.unstubAllGlobals(); setupOrder.length = 0; alertsApi.alerts = []; bars.candles = [candle]; drawingState.tool = null; drawingState.selection = []; series.priceToCoordinate.mockReturnValue(null); document.body.innerHTML = '' })

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

describe('TradingChart favorites bar (S3)', () => {
  it('floats the bar in the chart box\'s container, over the chart, where the legend it keeps clear of is', async () => {
    const { box, unmount } = await render()

    expect(favoritesArea).toBe(box.parentElement)
    expect(favoritesArea!.querySelector('[data-chart-legend]')!.textContent).toContain('Cie')
    unmount()
  })
})

describe('TradingChart remembered drawing styles (S2)', () => {
  it('while it is open, a new drawing takes the style remembered for its tool', async () => {
    const { unmount } = await render()
    const styleFor = vi.mocked(setDefaultStyleOverride).mock.calls.at(-1)![0]
    setToolStyle('parallel-channel', { color: '#f23645' })

    expect(styleFor('parallel-channel')).toEqual({ color: '#f23645' })
    expect(styleFor('trend-line')).toBeUndefined()

    unmount()
    expect(vi.mocked(setDefaultStyleOverride).mock.calls.at(-1)![0]('parallel-channel')).toBeUndefined()
    setToolStyle('parallel-channel', null)
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
    alertsApi.alerts = [{ id: 'a1', ticker: 'BTCUSDT', operator: 'crosses_above', value: 90000, name: 'BTCUSDT cruza por encima de 90.000', status: 'active', ...PRICE_VALUE }]
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

// odd/tasks/chart-customization.md S1: with a finger, an alert is selected before it moves.
describe('TradingChart alerts: select before move', () => {
  const ALERT = { id: 'a1', ticker: 'BTCUSDT', operator: 'crosses_above', value: 90000, name: 'BTCUSDT cruza por encima de 90.000', status: 'active', ...PRICE_VALUE }
  // The line sits at y 100; y 150 is price 85 on the stand-in (100 - y / 10).
  async function withAlert() {
    alertsApi.alerts = [ALERT]
    series.priceToCoordinate.mockReturnValue(100 as never)
    return render()
  }
  const bar = () => document.querySelector('[role="dialog"][aria-label="BTCUSDT cruza por encima de 90.000"]')
  const find = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent === text)
  const held = () => chart.applyOptions.mock.calls.some(([o]) => (o as { handleScroll?: boolean }).handleScroll === false)
  const lineWidth = () => (series.createPriceLine.mock.calls.at(-1) as unknown as [{ lineWidth: number }])[0].lineWidth
  const tapAt = async (box: HTMLElement, y: number, pointerType = 'touch') => {
    act(() => {
      box.dispatchEvent(new PointerEvent('pointerdown', { clientY: y, pointerType, bubbles: true }))
      window.dispatchEvent(new PointerEvent('pointerup', { clientY: y, pointerType }))
    })
    await act(async () => {})
  }
  const dragFrom = async (box: HTMLElement, from: number, to: number, pointerType = 'touch') => {
    act(() => {
      box.dispatchEvent(new PointerEvent('pointerdown', { clientY: from, pointerType, bubbles: true }))
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: (from + to) / 2, pointerType }))
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: to, pointerType }))
      window.dispatchEvent(new PointerEvent('pointerup', { clientY: to, pointerType }))
    })
    await act(async () => {})
  }

  it('a finger dragging across an alert that is not selected pans the chart: the alert stays, unselected', async () => {
    const { box, unmount } = await withAlert()

    await dragFrom(box, 100, 150)

    expect(held()).toBe(false)
    expect(alertsApi.move).not.toHaveBeenCalled()
    expect(bar()).toBeNull()
    unmount()
  })

  it('a finger tap selects it: the line is highlighted and a bar offers Borrar and Listo', async () => {
    const { box, unmount } = await withAlert()
    expect(lineWidth()).toBe(1)

    await tapAt(box, 100)

    expect(bar()).not.toBeNull()
    expect(find('Borrar')).toBeDefined()
    expect(find('Listo')).toBeDefined()
    expect(find('Eliminar')).toBeUndefined()
    expect(lineWidth()).toBe(2)
    expect(alertsApi.move).not.toHaveBeenCalled()
    unmount()
  })

  it('selecting an alert deselects the drawings: one thing selected at a time', async () => {
    const { box, unmount } = await withAlert()

    await tapAt(box, 100)

    expect(drawingSelect).toHaveBeenCalledWith([])
    unmount()
  })

  it('a finger drags the selected alert to a new price', async () => {
    const { box, unmount } = await withAlert()
    await tapAt(box, 100)
    alertsApi.move.mockResolvedValueOnce(true)

    await dragFrom(box, 100, 150)

    expect(held()).toBe(true)
    expect(alertsApi.move).toHaveBeenCalledWith('a1', 85)
    expect(bar()).not.toBeNull()
    expect((bar() as HTMLElement).style.top).toBe('78px') // the bar follows the line, now at y 150
    unmount()
  })

  it('a tap on an empty part of the chart deselects', async () => {
    const { box, unmount } = await withAlert()
    await tapAt(box, 100)

    await tapAt(box, 250)

    expect(bar()).toBeNull()
    expect(lineWidth()).toBe(1)
    unmount()
  })

  it('panning the chart keeps the alert selected', async () => {
    const { box, unmount } = await withAlert()
    await tapAt(box, 100)

    await dragFrom(box, 250, 200)

    expect(bar()).not.toBeNull()
    unmount()
  })

  it('Listo deselects', async () => {
    const { box, unmount } = await withAlert()
    await tapAt(box, 100)

    act(() => find('Listo')!.click())

    expect(bar()).toBeNull()
    unmount()
  })

  it('Borrar deletes the alert', async () => {
    const { box, unmount } = await withAlert()
    await tapAt(box, 100)

    act(() => find('Borrar')!.click())

    expect(alertsApi.remove).toHaveBeenCalledWith('a1')
    expect(bar()).toBeNull()
    unmount()
  })

  it('the mouse still drags an alert straight away, selected or not', async () => {
    const { box, unmount } = await withAlert()

    await dragFrom(box, 100, 150, 'mouse')

    expect(held()).toBe(true)
    expect(alertsApi.move).toHaveBeenCalledWith('a1', 85)
    unmount()
  })

  it('a mouse click selects it, as a tap does', async () => {
    const { box, unmount } = await withAlert()

    await tapAt(box, 100, 'mouse')

    expect(bar()).not.toBeNull()
    unmount()
  })

  it("a finger's press reaches select-before-move before the drawing layer", async () => {
    const { unmount } = await render()

    expect(setupOrder).toEqual(['select before move', 'drawing layer'])
    unmount()
  })
})

// odd/tasks/chart-customization.md S5: each indicator line takes its saved style without the chart
// rebuilding its panes; S4: the account's settings for an indicator win over this device's values;
// S8: with nothing saved, every series looks exactly as before.
describe('TradingChart indicator styles', () => {
  type Rec = Record<string, unknown>
  interface Made { type: unknown; pane: number; options: Rec; data: Rec[]; lines: { options: Rec }[]; fills: { paneViews: () => { renderer: () => unknown }[] }[] }
  let made: Made[]
  const initial = useChartStore.getState()
  // One recording series per indicator line, in the order the chart adds them; the candles keep the shared one.
  beforeEach(() => {
    made = []
    chart.addSeries.mockImplementation(((type: unknown, options: Rec, pane = 0) => {
      if (type === lwc.CandlestickSeries) return series
      const m: Made = { type, pane, options: { ...options }, data: [], lines: [], fills: [] }
      made.push(m)
      return {
        applyOptions: (o: Rec) => Object.assign(m.options, o),
        priceScale: () => ({ applyOptions: () => {} }),
        setData: (d: Rec[]) => { m.data = d },
        createPriceLine: (o: Rec) => {
          const line = { options: { ...o }, applyOptions: (p: Rec) => Object.assign(line.options, p) }
          m.lines.push(line)
          return line
        },
        removePriceLine: (line: unknown) => { m.lines = m.lines.filter((l) => l !== line) },
        attachPrimitive: (p: Made['fills'][number] & { attached: (h: unknown) => void }) => {
          p.attached({ chart: { timeScale: () => ({ timeToCoordinate: (t: number) => t }) }, series: { priceToCoordinate: (v: number) => 100 - v }, requestUpdate() {} })
          m.fills.push(p)
        },
      }
    }) as never)
  })
  afterEach(() => {
    chart.addSeries.mockImplementation(() => series)
    INDICATOR_KEYS.forEach((k) => setIndicatorSettings(k, null))
    useChartStore.setState(initial, true)
  })
  const options = () => made.map((m) => m.options)
  const legend = () => document.querySelector('[data-chart-legend]')!.textContent
  const lineOptions = (color: string) => ({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceFormat: expect.objectContaining({ type: 'custom' }), visible: true })
  const barOptions = (color: string, volume = false) => ({ color, priceLineVisible: false, lastValueVisible: false, priceFormat: volume ? { type: 'volume' } : expect.objectContaining({ type: 'custom' }), visible: true })
  const drawsFill = (m: Made) => m.fills.some((f) => f.paneViews()[0].renderer() !== null)

  it("with nothing saved, every line has today's color and width, the levels today's look, and no fill (S8)", async () => {
    const { unmount } = await render()

    // The indicators the store turns on, in INDICATOR_ORDER.
    expect(options()).toEqual([
      lineOptions('#00BCD4'), lineOptions('#FF9800'), lineOptions('#E91E63'),
      barOptions('#787b86', true),
      lineOptions('#7E57C2'),
      lineOptions('#2196F3'), lineOptions('#e0904a'), barOptions('#8f887e'),
      lineOptions('#2196F3'), lineOptions('#e0904a'),
      lineOptions('#B0BEC5'), lineOptions('#3f8c45'), lineOptions('#c8382a'),
    ])
    // lineVisible: the library's default, true.
    expect(made.flatMap((m) => m.lines.map(({ options: { lineVisible, ...o } }) => (lineVisible === false ? 'hidden' : o)))).toEqual(
      [30, 70, 20, 80, 25].map((price) => ({ price, color: '#222', lineStyle: 2, lineWidth: 1, axisLabelVisible: false })),
    )
    expect(made.some((m) => m.data.some((p) => 'color' in p))).toBe(false)
    expect(made.some(drawsFill)).toBe(false)
    unmount()
  })

  it("a saved line color, width and visibility restyle that series only, without rebuilding the panes", async () => {
    const list = panes(6)
    chart.panes.mockReturnValue(list as never)
    const { unmount } = await render()
    list.forEach((p) => p.setStretchFactor.mockClear())

    act(() => setIndicatorSettings('ema50', { values: { ema50: 50 }, style: { lines: { ema50: { color: '#f23645', width: 3, visible: false } } } }))

    expect(made[1].options).toMatchObject({ color: '#f23645', lineWidth: 3, visible: false })
    expect(made[0].options).toMatchObject({ color: '#00BCD4', lineWidth: 1, visible: true })
    expect(made).toHaveLength(13)
    expect(chart.removeSeries).not.toHaveBeenCalled()
    list.forEach((p) => expect(p.setStretchFactor).not.toHaveBeenCalled())
    unmount()
  })

  it('RSI levels take their saved value and color, and the fill between them follows', async () => {
    const { unmount } = await render()
    const rsi = made[4]
    expect(drawsFill(rsi)).toBe(false)

    act(() => setIndicatorSettings('rsi', { style: { levels: [{ value: 30 }, { value: 80, color: '#f23645' }], fills: { levels: { visible: true, color: '#9c27b0', transparency: 50 } } } }))

    expect(rsi.lines.map((l) => [l.options.price, l.options.color])).toEqual([[30, '#222'], [80, '#f23645']])
    const calls: unknown[][] = []
    const ctx = new Proxy({} as Rec, { get: (t, k) => (k in t ? t[k as string] : (...a: unknown[]) => calls.push([k, ...a])), set: (t, k, v) => { t[k as string] = v; return true } })
    const renderer = rsi.fills[0].paneViews()[0].renderer() as { draw: (t: unknown) => void }
    renderer.draw({ useMediaCoordinateSpace: (f: (s: unknown) => void) => f({ context: ctx, mediaSize: { width: 300, height: 100 } }) })
    expect(ctx.fillStyle).toBe('#9c27b0')
    expect(calls).toContainEqual(['fillRect', 0, 20, 300, 50]) // y(80) = 20 to y(30) = 70
    unmount()
  })

  it('the MACD histogram takes its rising color and can be hidden; volume bars take the rising color of their candle', async () => {
    const { unmount } = await render()

    act(() => {
      setIndicatorSettings('macd', { style: { lines: { histogram: { upColor: '#089981', downColor: '#089981', visible: false } } } })
      setIndicatorSettings('volume', { style: { lines: { volume: { upColor: '#089981', downColor: '#f23645' } } } })
    })

    expect(made[7].options).toMatchObject({ color: '#089981', visible: false })
    expect(made[3].data).toEqual([{ time: 1, value: undefined, color: '#089981' }]) // the one candle closed up
    unmount()
  })

  it('the Bollinger fill is drawn when turned on and gone when turned off', async () => {
    useChartStore.setState({ indicators: { ...initial.indicators, bollinger: true } })
    const { unmount } = await render()
    const upper = made.find((m) => m.options.color === '#2962FF')!

    act(() => setIndicatorSettings('bollinger', { style: { fills: { bands: { visible: true } } } }))
    expect(drawsFill(upper)).toBe(true)

    act(() => setIndicatorSettings('bollinger', { style: { fills: { bands: { visible: false } } } }))
    expect(drawsFill(upper)).toBe(false)
    unmount()
  })

  it("an indicator's saved values win over this device's; the other indicators keep the device's (S4)", async () => {
    // Two indicators: the legend lists them open.
    const only = Object.fromEntries(Object.keys(initial.indicators).map((k) => [k, k === 'ema20' || k === 'rsi'])) as typeof initial.indicators
    useChartStore.setState({ indicators: only, config: { ...DEFAULT_CONFIG, ema20: 30, rsi: 9 } })
    const { unmount } = await render()
    expect(legend()).toContain('RSI 9')

    act(() => setIndicatorSettings('rsi', { values: { rsi: 21 } }))

    expect(legend()).toContain('RSI 21')
    expect(legend()).toContain('EMA 30')
    expect(useChartStore.getState().config.rsi).toBe(9)
    unmount()
  })

  // odd/tasks/chart-customization.md S6: an indicator against a value draws its line in that indicator's pane.
  it('an RSI alert against 70 draws its line in the RSI pane, in its color', async () => {
    alertsApi.alerts = [{ id: 'r1', ticker: 'BTCUSDT', name: 'n', status: 'active', color: '#089981', source: 'rsi.rsi', operator: 'crosses_above', target: 'value', value: 70, timeframe: '1h', periods: { rsi: 14 } }]
    const { unmount } = await render()

    const rsi = made[4]
    expect(rsi.pane).toBe(2)
    expect(rsi.lines.map((l) => l.options).filter((o) => o.title === 'Alerta')).toEqual([
      { price: 70, color: '#089981', lineStyle: 0, lineWidth: 1, axisLabelVisible: true, title: 'Alerta' },
    ])
    expect(series.createPriceLine).not.toHaveBeenCalled()
    unmount()
  })

  it('with RSI off, an RSI alert draws no line anywhere', async () => {
    useChartStore.setState({ indicators: { ...initial.indicators, rsi: false } })
    alertsApi.alerts = [{ id: 'r1', ticker: 'BTCUSDT', name: 'n', status: 'active', color: null, source: 'rsi.rsi', operator: 'crosses_above', target: 'value', value: 70, timeframe: '1h', periods: { rsi: 14 } }]
    const { unmount } = await render()

    expect(made.flatMap((m) => m.lines).filter((l) => l.options.title === 'Alerta')).toEqual([])
    expect(series.createPriceLine).not.toHaveBeenCalled()
    unmount()
  })

  it("the legend's eye still hides every line of an indicator, whatever its saved style (S8)", async () => {
    const { unmount } = await render()
    act(() => setIndicatorSettings('rsi', { style: { lines: { rsi: { visible: true } }, fills: { levels: { visible: true } } } }))

    act(() => useChartStore.getState().toggleHidden('rsi'))

    expect(made[4].options.visible).toBe(false)
    expect(drawsFill(made[4])).toBe(false)
    expect(made[0].options.visible).toBe(true)
    unmount()
  })
})

// odd/tasks/chart-customization.md S6: the alert sheet from the menu and from the selected alert's ⚙; colors on the lines.
describe('TradingChart alert sheet', () => {
  const ALERT = { id: 'a1', ticker: 'BTCUSDT', operator: 'crosses_above', value: 90000, name: 'BTCUSDT cruza por encima de 90.000', status: 'active', color: null, source: 'price', target: 'value', timeframe: null, periods: null }
  const sheet = () => document.querySelector<HTMLElement>('[role="dialog"][aria-labelledby]')
  const inSheet = (text: string) => [...(sheet()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === text)
  const alertTitles = () => (series.createPriceLine.mock.calls as unknown as [{ title?: string; color: string }][]).map(([o]) => o).filter((o) => o.title === 'Alerta')
  const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })

  it('"Nueva alerta…" opens the sheet with the last price; Guardar creates the alert and closes it', async () => {
    const { unmount } = await render()

    act(() => button('Nueva alerta…').click())
    await flush()
    expect(sheet()!.textContent).toContain('Nueva alerta · BTCUSDT')
    expect(sheet()!.querySelector<HTMLInputElement>('[aria-label="Valor"]')!.value).toBe('1,5')

    await act(async () => { inSheet('Guardar')!.click() })
    await flush()

    expect(alertsApi.save).toHaveBeenCalledWith(null, { source: 'price', operator: 'crosses', target: 'value', value: 1.5, timeframe: null, periods: null, color: null })
    expect(sheet()).toBeNull()
    unmount()
  })

  it("an indicator alert takes the chart's timeframe and the indicator's period the chart uses", async () => {
    useChartStore.setState({ config: { ...DEFAULT_CONFIG, rsi: 21 } })
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => { root.render(<TradingChart symbol="BTCUSDT" timeframe="4h" />) })

    act(() => button('Nueva alerta…').click())
    await flush()
    const when = sheet()!.querySelector<HTMLSelectElement>('[aria-label="Cuando"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(when, 'rsi.rsi')
      when.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => { inSheet('Guardar')!.click() })

    expect(alertsApi.save).toHaveBeenCalledWith(null, expect.objectContaining({ source: 'rsi.rsi', timeframe: '4h', periods: { rsi: 21 } }))
    act(() => root.unmount())
    useChartStore.setState({ config: { ...DEFAULT_CONFIG } })
  })

  it("the selected alert's bar has ⚙, which opens its sheet", async () => {
    alertsApi.alerts = [ALERT]
    series.priceToCoordinate.mockReturnValue(100 as never)
    const { box, unmount } = await render()
    act(() => {
      box.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, pointerType: 'touch', bubbles: true }))
      window.dispatchEvent(new PointerEvent('pointerup', { clientY: 100, pointerType: 'touch' }))
    })
    await act(async () => {})

    act(() => document.querySelector<HTMLButtonElement>('[role="dialog"][aria-label="BTCUSDT cruza por encima de 90.000"] [aria-label="Configuración"]')!.click())
    await flush()

    expect(sheet()!.textContent).toContain('Alerta · BTCUSDT')
    expect(sheet()!.querySelector<HTMLInputElement>('[aria-label="Valor"]')!.value).toBe('90000')
    unmount()
  })

  it('an alert from the menu list opens its sheet; Borrar alerta deletes it and closes the sheet', async () => {
    alertsApi.alerts = [ALERT]
    const { unmount } = await render()

    act(() => button('abrir a1').click())
    await flush()
    act(() => inSheet('Borrar alerta')!.click())
    await flush()

    expect(alertsApi.remove).toHaveBeenCalledWith('a1')
    expect(sheet()).toBeNull()
    unmount()
  })

  it("an alert's color reaches its line; one with no color keeps the accent, as before", async () => {
    alertsApi.alerts = [{ ...ALERT, color: '#f23645' }, { ...ALERT, id: 'a2', value: 80000 }]
    const { unmount } = await render()

    expect(alertTitles().slice(-2).map((o) => o.color)).toEqual(['#f23645', '#0a0']) // the lines drawn last
    unmount()
  })

  it('redrawing the alert lines removes the ones drawn before, as it always did', async () => {
    alertsApi.alerts = [ALERT]
    series.priceToCoordinate.mockReturnValue(100 as never)
    const { box, unmount } = await render()
    const before = series.createPriceLine.mock.results.at(-1)!.value

    act(() => {
      box.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, pointerType: 'touch', bubbles: true }))
      window.dispatchEvent(new PointerEvent('pointerup', { clientY: 100, pointerType: 'touch' }))
    })
    await act(async () => {})

    expect(series.removePriceLine).toHaveBeenCalledWith(before)
    unmount()
  })

  it('an alert against a line draws no line, and a finger on the price there selects nothing', async () => {
    alertsApi.alerts = [{ ...ALERT, target: 'ema50.ema50', value: null, timeframe: '1d', periods: { ema50: 50 } }]
    series.priceToCoordinate.mockReturnValue(100 as never)
    const { box, unmount } = await render()

    act(() => {
      box.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, pointerType: 'touch', bubbles: true }))
      window.dispatchEvent(new PointerEvent('pointerup', { clientY: 100, pointerType: 'touch' }))
    })
    await act(async () => {})

    expect(alertTitles()).toEqual([])
    expect(document.querySelector('[role="dialog"][aria-label="BTCUSDT cruza por encima de 90.000"]')).toBeNull()
    unmount()
  })
})

// The user's buys and sells on the candles, from the app's operations (the Historial's).
const { forgetCached } = await import('@/lib/client-cache')
describe('TradingChart trade markers', () => {
  const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000
  const DAYS = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']
  const TRADES = [
    { id: 't3', date: '2026-10-22', operation: 'VENTA', quantity: 5, price: 1300 },
    { id: 't2', date: '2026-10-20', operation: 'COMPRA', quantity: 4, price: 1240.5 },
    { id: 't1', date: '2026-10-20', operation: 'COMPRA', quantity: 6, price: 1234.5 },
    { id: 't0', date: '2026-10-21', operation: 'DIVIDENDO', quantity: 1, price: 12 },
  ]
  let answer: () => Response
  const tradeRequests = () => vi.mocked(fetch).mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/transactions'))
  beforeEach(() => {
    forgetCached()
    useChartStore.setState({ showTrades: true })
    bars.candles = DAYS.map((d) => ({ ...candle, time: day(d) }))
    answer = () => Response.json({ data: TRADES, pagination: { page: 1, limit: 500, total: 4, totalPages: 1 } })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).startsWith('/api/transactions') ? answer() : new Response(null, { status: 404 }))))
  })
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  async function mount(symbol = 'BCBA:GGAL', timeframe: '1d' | '1w' = '1d') {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    const draw = (tf: typeof timeframe) => act(async () => { root.render(<TradingChart symbol={symbol} timeframe={tf} />) })
    await draw(timeframe)
    await settle()
    const box = vi.mocked(createChart).mock.calls[0][0] as HTMLElement
    return { box, rerender: draw, unmount: () => act(() => root.unmount()) }
  }
  const lastMarkers = () => markers.setMarkers.mock.calls.at(-1)![0]
  const click = (time: number | undefined, x = time ?? 0, y = 200) =>
    act(() => { (chart.subscribeClick.mock.calls.at(-1) as unknown as [(p: unknown) => void])[0]({ time, point: { x, y }, paneIndex: 0 }) })
  const card = () => document.querySelector('[role="dialog"][aria-label="Operaciones"]')
  const press = (box: HTMLElement, pointerType = 'mouse') => act(() => {
    box.dispatchEvent(new PointerEvent('pointerdown', { clientY: 200, pointerType, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientY: 200, pointerType }))
  })

  it("asks for the symbol's operations and draws a green arrow under the buys and a red one over the sells", async () => {
    const { unmount } = await mount()

    expect(tradeRequests()).toEqual(['/api/transactions?ticker=BCBA%3AGGAL&limit=500'])
    expect(lastMarkers()).toEqual([
      { time: day('2026-10-20'), position: 'belowBar', shape: 'arrowUp', color: '#0f0' },
      { time: day('2026-10-22'), position: 'aboveBar', shape: 'arrowDown', color: '#f00' },
    ])
    unmount()
  })

  it('a timeframe change moves the arrows to the new bars without asking again', async () => {
    const { rerender, unmount } = await mount()
    bars.candles = [{ ...candle, time: day('2026-10-19') }]

    await rerender('1w')
    await settle()

    expect(tradeRequests()).toHaveLength(1)
    expect(lastMarkers().map((m: { time: number; shape: string }) => [m.time, m.shape])).toEqual([[day('2026-10-19'), 'arrowUp'], [day('2026-10-19'), 'arrowDown']])
    unmount()
  })

  it('a failed request shows no arrows and no error', async () => {
    answer = () => Response.json({ error: 'x' }, { status: 500 })
    const { unmount } = await mount()

    expect(markers.setMarkers.mock.calls.every(([m]) => m.length === 0)).toBe(true)
    expect(document.querySelector('[role="alert"]')).toBeNull()
    unmount()
  })

  it('Mostrar operaciones off hides the arrows, and on shows them again', async () => {
    const { unmount } = await mount()

    await act(async () => { useChartStore.getState().toggleShowTrades() })
    expect(lastMarkers()).toEqual([])

    await act(async () => { useChartStore.getState().toggleShowTrades() })
    await settle()
    expect(lastMarkers()).toHaveLength(2)
    unmount()
  })

  it("a click on an arrow's bar shows each operation in it: date, operation, quantity and price", async () => {
    const { box, unmount } = await mount()
    press(box)

    click(day('2026-10-20'))

    const rows = [...card()!.querySelectorAll('tbody tr')].map((r) => [...r.querySelectorAll('td')].map((c) => c.textContent))
    expect(rows).toEqual([['20/10/2026', 'Compra', '4', '1.240,50'], ['20/10/2026', 'Compra', '6', '1.234,50']])
    unmount()
  })

  it('on a phone it opens as a sheet from the bottom: one row per operation, and Listo closes it', async () => {
    onPhone(true)
    const { box, unmount } = await mount()
    press(box, 'touch')

    click(day('2026-10-20'))
    await act(async () => {})

    const sheet = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.textContent?.startsWith('Operaciones'))!
    const rows = [...sheet.querySelectorAll('li')].map((r) => [...r.querySelectorAll('span')].map((c) => c.textContent))
    expect(rows).toEqual([['Compra', '20/10/2026', 'Cantidad', '4', 'Precio', '1.240,50'], ['Compra', '20/10/2026', 'Cantidad', '6', 'Precio', '1.234,50']])
    expect(card()).toBeNull()

    await act(async () => button('Listo').click())
    expect([...document.querySelectorAll('[role="dialog"]')].some((d) => d.textContent?.startsWith('Operaciones'))).toBe(false)
    unmount()
  })

  // odd/tasks/split-aware-ledger.md S5: a trade with stored splits after it also says what it is in today's shares.
  const SPLIT = { splits: [{ date: '2026-10-21', numerator: 2, denominator: 1 }], factor: 2, quantity: 8, price: 620.25 }
  const LINE = 'Tras el split 2:1 del 21/10/2026: 8 acciones a US$\u00a0620,25'
  const withSplit = () => Response.json({ data: TRADES.map((t) => (t.id === 't2' ? { ...t, after_splits: SPLIT } : t)), pagination: { page: 1, limit: 500, total: 4, totalPages: 1 } })

  it('the card shows the line under the trade with after_splits and nothing under the others, from the same request', async () => {
    answer = withSplit
    const { box, unmount } = await mount()
    press(box)

    click(day('2026-10-20'))

    expect([...card()!.querySelectorAll('tbody tr')].map((r) => r.textContent)).toEqual(['20/10/2026Compra41.240,50', LINE, '20/10/2026Compra61.234,50'])
    expect(tradeRequests()).toHaveLength(1)
    unmount()
  })

  it('the phone sheet shows the line under the trade with after_splits and nothing under the others', async () => {
    onPhone(true)
    answer = withSplit
    const { box, unmount } = await mount()
    press(box, 'touch')

    click(day('2026-10-20'))
    await act(async () => {})

    const sheet = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.textContent?.startsWith('Operaciones'))!
    const items = [...sheet.querySelectorAll('li')]
    expect(items[0].querySelector('p')?.textContent).toBe(LINE)
    expect(items[1].querySelector('p')).toBeNull()
    expect(sheet.textContent!.split('Tras ')).toHaveLength(2)
    unmount()
  })

  it('a click elsewhere closes it, and so does Cerrar', async () => {
    const { box, unmount } = await mount()
    press(box)
    click(day('2026-10-22'))
    expect(card()).not.toBeNull()

    press(box)
    click(day('2026-10-19'))
    expect(card()).toBeNull()

    press(box)
    click(day('2026-10-22'))
    act(() => card()!.querySelector<HTMLButtonElement>('button[aria-label="Cerrar"]')!.click())
    expect(card()).toBeNull()
    unmount()
  })

  it("a finger only has to land near the arrow's bar", async () => {
    const { box, unmount } = await mount()
    press(box, 'touch')

    click(day('2026-10-19'), day('2026-10-22') - 20)

    expect(card()).not.toBeNull()
    unmount()
  })

  it('does not open while a drawing tool is armed', async () => {
    const { box, unmount } = await mount()
    drawingState.tool = 'trend-line'
    press(box)

    click(day('2026-10-20'))

    expect(card()).toBeNull()
    unmount()
  })

  it('does not open on the press that places an alert', async () => {
    const { box, unmount } = await mount()
    act(() => button('Alerta').click())
    press(box)

    click(day('2026-10-20'))

    expect(alertsApi.create).toHaveBeenCalled()
    expect(card()).toBeNull()
    unmount()
  })

  it('does not open when the click selects a drawing', async () => {
    const { box, unmount } = await mount()
    drawingState.selection = ['d1']
    press(box)

    click(day('2026-10-20'))

    expect(card()).toBeNull()
    unmount()
  })
})

// odd/tasks/chart-customization.md L16: one thing selected or armed at a time.
describe('TradingChart one selection at a time', () => {
  const ALERT = { id: 'a1', ticker: 'BTCUSDT', operator: 'crosses_above', value: 90000, name: 'BTCUSDT cruza por encima de 90.000', status: 'active', ...PRICE_VALUE }
  const bar = () => document.querySelector('[role="dialog"][aria-label="BTCUSDT cruza por encima de 90.000"]')
  async function withSelectedAlert() {
    alertsApi.alerts = [ALERT]
    series.priceToCoordinate.mockReturnValue(100 as never)
    const rendered = await render()
    act(() => {
      rendered.box.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, pointerType: 'touch', bubbles: true }))
      window.dispatchEvent(new PointerEvent('pointerup', { clientY: 100, pointerType: 'touch' }))
    })
    await act(async () => {})
    expect(bar()).not.toBeNull()
    return rendered
  }

  it('arming a drawing tool (from the strip, the list or the favorites bar) lets go of the selected alert', async () => {
    const { unmount } = await withSelectedAlert()

    act(() => drawingEvents.tool('trend-line'))

    expect(bar()).toBeNull()
    unmount()
  })

  it('disarming a tool keeps the selected alert', async () => {
    const { unmount } = await withSelectedAlert()

    act(() => drawingEvents.tool(null))

    expect(bar()).not.toBeNull()
    unmount()
  })

  it('selecting an alert disarms the drawing tool and deselects the drawings', async () => {
    const { unmount } = await withSelectedAlert()

    expect(drawingSetTool).toHaveBeenCalledWith(null)
    expect(drawingSelect).toHaveBeenCalledWith([])
    unmount()
  })

  it('arming the alert placement lets go of the selected alert and the drawings', async () => {
    const { unmount } = await withSelectedAlert()
    drawingSelect.mockClear()

    act(() => button('Alerta').click())

    expect(bar()).toBeNull()
    expect(drawingSelect).toHaveBeenCalledWith([])
    unmount()
  })
})

describe('TradingChart — Mi cartera', () => {
  it('is a line of its value, not candles', async () => {
    const { unmount } = await render('__portfolio__')

    expect((chart.addSeries.mock.calls as unknown[][])[0][0]).toBe(lwc.LineSeries)
    expect(series.setData).toHaveBeenCalledWith([{ time: 1, value: 1.5 }])
    unmount()
  })

  it('going back to a stock brings its candles back', async () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => { root.render(<TradingChart symbol="__portfolio__" timeframe="1d" />) })
    await act(async () => { root.render(<TradingChart symbol="AAPL" timeframe="1d" />) })

    expect((chart.addSeries.mock.calls as unknown[][]).map((c) => c[0])).toContain(lwc.CandlestickSeries)
    expect(vi.mocked(createChart)).toHaveBeenCalledTimes(2)
    expect(series.setData).toHaveBeenCalledWith([{ ...candle, time: 1 }])
    act(() => root.unmount())
  })
})

describe('TradingChart — comparing', () => {
  const NO_INDICATORS = Object.fromEntries(INDICATOR_KEYS.map((k: string) => [k, false]))
  const SPY = { points: [{ time: '1970-01-01', value: 400 }] }
  async function renderTf(symbol: string, timeframe: '1d' | '1h', compared: string[]) {
    useChartStore.setState({ compareSymbols: compared, indicators: NO_INDICATORS as never })
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    const show = (tf: '1d' | '1h') => act(async () => { root.render(<TradingChart symbol={symbol} timeframe={tf} />) })
    await show(timeframe)
    return { el, show, unmount: () => act(() => root.unmount()) }
  }
  const seriesKinds = () => (chart.addSeries.mock.calls as unknown[][]).map((c) => c[0])
  const modes = () => (priceScale.applyOptions.mock.calls as { mode?: number }[][]).map((c) => c[0].mode).filter((m) => m !== undefined)
  // The scale's labels: the last price format the chart gave its series.
  const lastFormat = () => (series.applyOptions.mock.calls as { priceFormat?: { formatter: (p: number) => string } }[][]).map((c) => c[0].priceFormat).filter(Boolean).at(-1)
  const TWO_DAYS = [{ time: 0, open: 1, high: 2, low: 0.5, close: 1.5 }, { time: 86400, open: 3, high: 3, low: 3, close: 3 }]
  const SPY_TWO = { points: [{ time: '1970-01-01', value: 400 }, { time: '1970-01-02', value: 440 }] }
  const scaledLine = () => (series.setData.mock.calls as { time: number; value: number }[][][]).map((c) => c[0]).find((d) => d.length === 2 && d[0].value === 1.5 && !('close' in d[0]))

  it('draws each compared asset from the chart\'s own price on the first day, and labels the scale in % from that day', async () => {
    compare.status = 'ready'
    compare.series = { SPY: SPY_TWO }
    bars.candles = TWO_DAYS
    useChartStore.setState({ compareRange: 'Todo' })
    const { el, unmount } = await renderTf('AAPL', '1d', ['SPY'])

    expect(useCompareSeries).toHaveBeenLastCalledWith(['SPY'], false)
    expect(seriesKinds()).toEqual([lwc.CandlestickSeries, lwc.LineSeries])
    expect(scaledLine()![1].value).toBeCloseTo(1.65)
    expect(lastFormat()!.formatter(3)).toBe('+100,00 %')
    expect(modes()).toEqual([])
    expect(el.querySelector('[data-chart-legend]')!.textContent).toContain('AAPL+100,00 %SPY+10,00 %')
    unmount()
  })

  it('moving the chart never changes a number: every % is from the range\'s first day, not the first one in sight', async () => {
    compare.status = 'ready'
    compare.series = { SPY: SPY_TWO }
    bars.candles = TWO_DAYS
    getVisibleRange.mockReturnValue({ from: 86400, to: 86400 })
    useChartStore.setState({ compareRange: 'Todo' })
    const { el, unmount } = await renderTf('AAPL', '1d', ['SPY'])
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })

    expect(el.querySelector('[data-chart-legend]')!.textContent).toContain('AAPL+100,00 %SPY+10,00 %')
    unmount()
  })

  it('a comparison shows its range whole once; adding or taking out a line keeps the user\'s zoom', async () => {
    compare.status = 'ready'
    compare.series = { SPY: SPY_TWO, QQQ: SPY_TWO }
    bars.candles = TWO_DAYS
    const { unmount } = await renderTf('AAPL', '1d', ['SPY'])
    const rangeZooms = () => setVisibleLogicalRange.mock.calls.filter((c) => c[0].to === TWO_DAYS.length + 3)

    expect(rangeZooms()).toEqual([[{ from: 0, to: 5 }]])
    await act(async () => { useChartStore.getState().setCompareSymbols(['SPY', 'QQQ']) })
    await act(async () => { useChartStore.getState().setCompareSymbols(['SPY']) })
    expect(rangeZooms()).toHaveLength(1)
    unmount()
  })

  it('the bars of the last chart, still on screen right after a switch, never set the new one\'s zoom', async () => {
    compare.status = 'ready'
    compare.series = { SPY: SPY_TWO }
    bars.candles = TWO_DAYS
    bars.key = 'BTCUSDT:1d'
    const { show, unmount } = await renderTf('AAPL', '1d', ['SPY'])
    const rangeZooms = () => setVisibleLogicalRange.mock.calls.filter((c) => c[0].to === TWO_DAYS.length + 3)
    expect(rangeZooms()).toEqual([])

    bars.key = undefined
    await show('1d')
    expect(rangeZooms()).toEqual([[{ from: 0, to: 5 }]])
    unmount()
  })

  it('the indicators over the price read in % on the scale too, like every line', async () => {
    compare.status = 'ready'
    compare.series = { SPY: SPY_TWO }
    bars.candles = TWO_DAYS
    const ema = { applyOptions: vi.fn(), setData: vi.fn(), priceScale: () => priceScale, createPriceLine: vi.fn(() => ({ applyOptions: vi.fn() })), attachPrimitive: vi.fn() }
    chart.addSeries.mockImplementation(((_t: unknown, _o: unknown, pane?: number) => (pane === 0 ? ema : series)) as never)
    useChartStore.setState({ compareRange: 'Todo' })
    const { unmount } = await renderTf('AAPL', '1d', ['SPY'])
    useChartStore.setState({ indicators: { ...NO_INDICATORS, ema20: true } as never })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    const formats = (ema.applyOptions.mock.calls as { priceFormat?: { formatter: (p: number) => string } }[][]).map((c) => c[0].priceFormat).filter(Boolean)
    expect(formats.at(-1)!.formatter(3)).toBe('+100,00 %')
    chart.addSeries.mockImplementation(() => series)
    unmount()
  })

  it('the range buttons pick the first day, remembered; the chosen one is marked', async () => {
    compare.status = 'ready'
    compare.series = { SPY: SPY_TWO }
    bars.candles = TWO_DAYS
    useChartStore.setState({ compareRange: '1A' })
    const { unmount } = await renderTf('AAPL', '1d', ['SPY'])

    const group = document.querySelector('[role="group"][aria-label="Comparar desde"]')!
    expect([...group.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['1M', '3M', '6M', 'YTD', '1A', 'Todo'])
    expect(group.querySelector('[aria-pressed="true"]')!.textContent).toBe('1A')
    await act(async () => { button('6M').click() })
    expect(useChartStore.getState().compareRange).toBe('6M')
    unmount()
  })

  it('with nothing compared it asks for nothing and the scale stays in prices', async () => {
    const { el, unmount } = await renderTf('AAPL', '1d', [])

    expect(useCompareSeries).toHaveBeenLastCalledWith([], false)
    expect(seriesKinds()).toEqual([lwc.CandlestickSeries])
    expect(modes()).toEqual([])
    expect(lastFormat()?.formatter(3) ?? '3,00').not.toContain('%')
    expect(button('+ Comparar')).toBeTruthy()
    expect(document.querySelector('[aria-label="Comparar desde"]')).toBeNull()
    expect(el.textContent).not.toContain('Sin datos')
    unmount()
  })

  it('an asset without data says so and draws nothing', async () => {
    compare.status = 'ready'
    compare.series = { ZZZZ: { error: 'no_data' } }
    const { el, unmount } = await renderTf('AAPL', '1d', ['ZZZZ'])

    expect(el.textContent).toContain('ZZZZ')
    expect(el.textContent).toContain('Sin datos')
    expect(seriesKinds()).toEqual([lwc.CandlestickSeries])
    unmount()
  })

  it('on an intraday chart the lines wait, and come back on the daily one', async () => {
    compare.status = 'ready'
    compare.series = { SPY }
    const { el, show, unmount } = await renderTf('AAPL', '1h', ['SPY'])

    expect(useCompareSeries).toHaveBeenLastCalledWith([], false)
    expect(el.textContent).toContain('Las comparaciones se ven en diario, semanal o mensual')
    expect(seriesKinds()).toEqual([lwc.CandlestickSeries])

    await show('1d')
    expect(seriesKinds()).toEqual([lwc.CandlestickSeries, lwc.LineSeries])
    unmount()
  })

  it('× takes an asset out: its line goes and the scale is in prices again', async () => {
    compare.status = 'ready'
    compare.series = { SPY }
    const { unmount } = await renderTf('AAPL', '1d', ['SPY'])
    expect(lastFormat()!.formatter(3)).toContain('%')

    await act(async () => { document.querySelector<HTMLButtonElement>('button[aria-label="Quitar SPY de la comparación"]')!.click() })

    expect(useChartStore.getState().compareSymbols).toEqual([])
    expect(chart.removeSeries).toHaveBeenCalled()
    expect(lastFormat()!.formatter(3)).toBe('3,00')
    unmount()
  })

  it('a peso chart is drawn in dollars while comparing', async () => {
    compare.status = 'ready'
    compare.series = { SPY }
    compare.ccl = [{ time: '1970-01-01', value: 2 }]
    const { unmount } = await renderTf('GGAL.BA', '1d', ['SPY'])

    expect(useCompareSeries).toHaveBeenLastCalledWith(['SPY'], true)
    expect(series.setData).toHaveBeenCalledWith([{ time: 1, open: 0.5, high: 1, low: 0.25, close: 0.75 }])
    unmount()
  })

  it('the chart itself is never compared with itself', async () => {
    const { unmount } = await renderTf('SPY', '1d', ['SPY', 'QQQ'])

    expect(useCompareSeries).toHaveBeenLastCalledWith(['QQQ'], false)
    unmount()
  })

  it('opening Mi cartera the first time puts SPY next to it; taken out, it stays out', async () => {
    useChartStore.setState({ compareDefaulted: false })
    const first = await renderTf('__portfolio__', '1d', [])
    expect(useChartStore.getState().compareSymbols).toEqual(['SPY'])
    first.unmount()

    useChartStore.setState({ compareDefaulted: true })
    const again = await renderTf('__portfolio__', '1d', [])
    expect(useChartStore.getState().compareSymbols).toEqual([])
    again.unmount()
  })

  it('while comparing, the indicators keep drawing: they share the price scale with every line', async () => {
    compare.status = 'ready'
    compare.series = { SPY }
    useChartStore.setState({ compareSymbols: ['SPY'], indicators: { ...NO_INDICATORS, ema20: true, rsi: true } as never })
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => { root.render(<TradingChart symbol="AAPL" timeframe="1d" />) })

    expect((chart.addSeries.mock.calls as unknown[][]).some((c) => c[2] === 0)).toBe(true)
    expect(modes()).toEqual([])
    expect(el.textContent).not.toContain('ocultas al comparar')
    act(() => root.unmount())
  })

  it('Mi cartera has no volume to draw', async () => {
    useChartStore.setState({ indicators: { ...NO_INDICATORS, volume: true } as never })
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => { root.render(<TradingChart symbol="__portfolio__" timeframe="1d" />) })

    expect(seriesKinds()).not.toContain(lwc.HistogramSeries)
    act(() => root.unmount())
  })

  it('a peso chart drawn in dollars pauses its drawings and alerts, which are in pesos', async () => {
    compare.status = 'ready'
    compare.series = { SPY }
    compare.ccl = [{ time: '1970-01-01', value: 2 }]
    const { el, unmount } = await renderTf('GGAL.BA', '1d', ['SPY'])

    expect(toolbar.manager).toBeNull()
    expect(toolbar.alertsOff).toBe(true)
    expect(drawingsVisible).toHaveBeenLastCalledWith(false)
    expect(el.textContent).toContain('Dibujos y alertas: en pausa al comparar en dólares')
    unmount()
  })

  it('+ Comparar opens the sheet, and is gone with five compared', async () => {
    const first = await renderTf('AAPL', '1d', ['SPY'])
    await act(async () => { button('+ Comparar').click() })
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Comparar con')
    first.unmount()

    const full = await renderTf('AAPL', '1d', ['SPY', 'QQQ', 'DIA', 'EEM', 'VT'])
    expect(button('+ Comparar')).toBeUndefined()
    full.unmount()
  })
})

describe('TradingChart — Mi cartera without history', () => {
  it('says so with its name, never its internal one', async () => {
    bars.status = 'error'
    bars.error = 'Todavía no hay historia de tu cartera'
    const { unmount } = await render('__portfolio__')

    expect(document.body.textContent).toContain('Todavía no hay historia de tu cartera')
    expect(document.body.textContent).not.toContain('__portfolio__')
    unmount()
  })
})
