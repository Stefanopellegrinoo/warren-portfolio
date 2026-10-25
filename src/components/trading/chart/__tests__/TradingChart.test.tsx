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
const drawingSelect = vi.fn()
// What the chart set up, in order.
const setupOrder: string[] = []
vi.mock('lightweight-charts-drawing', () => ({
  DrawingManager: class {
    constructor() { setupOrder.push('drawing layer') }
    on(event: string, cb: (...a: unknown[]) => void) { drawingEvents[event] = cb; return () => {} }
    tool() { return null }
    select(ids: string[]) { drawingSelect(ids) }
    setInterval() {}
    destroy() {}
  },
  setDefaultStyleOverride: vi.fn(),
}))
vi.mock('@/lib/chart/select-before-move', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/chart/select-before-move')>()
  return { ...real, selectBeforeMove: (...a: Parameters<typeof real.selectBeforeMove>) => { setupOrder.push('select before move'); return real.selectBeforeMove(...a) } }
})

const candle = { time: 1, open: 1, high: 2, low: 0.5, close: 1.5 }
vi.mock('../useCandles', () => ({
  useCandles: () => ({ status: 'ready', candles: [candle], change: { kind: 'set' }, retry: () => {} }),
}))
vi.mock('../useDrawings', () => ({ useDrawings: () => 'ready' }))
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
vi.mock('../DrawingTools', () => ({
  DrawingTools: ({ onAlertMode, chartArea, alerts, onNewAlert, onOpenAlert }: { onAlertMode: (on: boolean) => void; chartArea?: HTMLElement | null; alerts?: { id: string }[]; onNewAlert?: () => void; onOpenAlert?: (id: string) => void }) => {
    favoritesArea = chartArea
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
const { INDICATOR_KEYS } = await import('@/lib/chart/preferences-schema')
const lwc = await import('lightweight-charts')

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); setupOrder.length = 0; alertsApi.alerts = []; series.priceToCoordinate.mockReturnValue(null); document.body.innerHTML = '' })

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
