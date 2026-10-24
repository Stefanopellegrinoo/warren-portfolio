import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { createChart } from 'lightweight-charts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// lightweight-charts draws on canvas, which jsdom lacks: a recording stand-in.
const series = {
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
vi.mock('lightweight-charts-drawing', () => ({
  DrawingManager: class {
    on() { return () => {} }
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
const alertsApi = { alerts: [], create: vi.fn(), move: vi.fn(), rearm: vi.fn(), remove: vi.fn() }
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

afterEach(() => { vi.clearAllMocks(); document.body.innerHTML = '' })

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
