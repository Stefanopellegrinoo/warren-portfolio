import { describe, it, expect, vi } from 'vitest'

// ── Mock all heavy dependencies so the module can be imported ────────────────
vi.mock('lightweight-charts', () => ({
  createChart: vi.fn(),
  createSeriesMarkers: vi.fn(),
  CandlestickSeries: vi.fn(),
  LineSeries: vi.fn(),
  HistogramSeries: vi.fn(),
  CrosshairMode: {},
  LineStyle: {},
}))

vi.mock('@/lib/binance/rest', () => ({ fetchKlines: vi.fn() }))
vi.mock('@/lib/binance/ws', () => ({ getBinanceWS: vi.fn() }))
vi.mock('@/lib/indicators', () => ({
  ema: vi.fn(),
  rsi: vi.fn(),
  macd: vi.fn(),
  bollinger: vi.fn(),
  obv: vi.fn(),
  stochastic: vi.fn(),
  adx: vi.fn(),
}))
vi.mock('@/lib/market-data/resolver', () => ({ getProviderForSymbol: vi.fn() }))
vi.mock('@/lib/warren/positions', () => ({ getTransactions: vi.fn() }))
vi.mock('@/lib/store/chart-store', () => ({
  useChartStore: vi.fn(() => ({})),
  INDICATOR_COLORS: {},
}))
vi.mock('@/lib/format', () => ({ formatPrice: vi.fn(), formatVolume: vi.fn() }))
vi.mock('@/lib/setup-color', () => ({ SIGNAL_COLORS: {}, getSetupColor: vi.fn() }))
vi.mock('./IndicatorPill', () => ({ IndicatorPill: vi.fn() }))
vi.mock('./MeasureOverlay', () => ({ MeasureOverlay: vi.fn() }))
vi.mock('sonner', () => ({ toast: vi.fn() }))
vi.mock('./AlertCreationWidget', () => ({ AlertCreationWidget: vi.fn() }))
vi.mock('./AlertEditWidget', () => ({ AlertEditWidget: vi.fn() }))

// ── Types ────────────────────────────────────────────────────────────────────

interface MinimalAlert {
  id: string
  value: number
  [key: string]: unknown
}

function makeRef(map: Map<string, MinimalAlert>) {
  return { current: map } as React.MutableRefObject<Map<string, MinimalAlert>>
}

// ── hitTestAlertLine tests ────────────────────────────────────────────────────

describe('hitTestAlertLine', () => {
  it('returns the alert id when mouseY is within tolerance', async () => {
    const { hitTestAlertLine } = await import('../PriceChart')

    const alertMap = new Map<string, MinimalAlert>([
      ['alert-1', { id: 'alert-1', value: 100 }],
    ])
    const ref = makeRef(alertMap as Map<string, MinimalAlert>)
    // priceToCoordinate: price 100 → coord 200
    const priceToCoord = (price: number) => price * 2

    const result = hitTestAlertLine(ref as never, 200, priceToCoord)
    expect(result).toBe('alert-1')
  })

  it('returns null when mouseY is outside tolerance', async () => {
    const { hitTestAlertLine } = await import('../PriceChart')

    const alertMap = new Map<string, MinimalAlert>([
      ['alert-1', { id: 'alert-1', value: 100 }],
    ])
    const ref = makeRef(alertMap as Map<string, MinimalAlert>)
    // coord = 200, mouseY = 220 → dist 20 > default tolerance 8
    const priceToCoord = (_: number) => 200

    const result = hitTestAlertLine(ref as never, 220, priceToCoord)
    expect(result).toBeNull()
  })

  it('returns the nearest alert id when multiple alerts are within tolerance', async () => {
    const { hitTestAlertLine } = await import('../PriceChart')

    // alert-1 at coord 200, alert-2 at coord 205 — mouseY=202 → dist(alert-1)=2, dist(alert-2)=3
    const alertMap = new Map<string, MinimalAlert>([
      ['alert-1', { id: 'alert-1', value: 1 }],
      ['alert-2', { id: 'alert-2', value: 2 }],
    ])
    const ref = makeRef(alertMap as Map<string, MinimalAlert>)
    const priceToCoord = (price: number) => price === 1 ? 200 : 205

    const result = hitTestAlertLine(ref as never, 202, priceToCoord)
    expect(result).toBe('alert-1')
  })

  it('returns null when priceToCoordinate returns null for all alerts', async () => {
    const { hitTestAlertLine } = await import('../PriceChart')

    const alertMap = new Map<string, MinimalAlert>([
      ['alert-1', { id: 'alert-1', value: 100 }],
    ])
    const ref = makeRef(alertMap as Map<string, MinimalAlert>)
    // Series not visible — always returns null
    const priceToCoord = (_: number): number | null => null

    const result = hitTestAlertLine(ref as never, 200, priceToCoord)
    expect(result).toBeNull()
  })
})

// ── isTap tests ───────────────────────────────────────────────────────────────

describe('isTap', () => {
  it('returns true when movement is less than 5px', async () => {
    const { isTap } = await import('../PriceChart')
    expect(isTap(100, 103)).toBe(true)
    expect(isTap(100, 97)).toBe(true)
    expect(isTap(100, 100)).toBe(true)
  })

  it('returns false when movement is 5px or more', async () => {
    const { isTap } = await import('../PriceChart')
    expect(isTap(100, 105)).toBe(false)
    expect(isTap(100, 95)).toBe(false)
    expect(isTap(100, 110)).toBe(false)
  })

  it('returns false at exactly 5px movement', async () => {
    const { isTap } = await import('../PriceChart')
    expect(isTap(100, 105)).toBe(false)
    expect(isTap(100, 95)).toBe(false)
  })
})
