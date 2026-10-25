// odd/tasks/chart-customization.md S5: how an indicator's saved style turns into what the chart draws.
// S4: the account's settings for an indicator win over this device's values. S8: nothing saved, nothing changes.
import { describe, it, expect, vi } from 'vitest'
import { DEFAULT_CONFIG, INDICATOR_COLORS } from '@/lib/store/chart-store'
import type { Candle } from '@/lib/binance/types'
import { INDICATOR_SPECS } from '../indicator-specs'
import { BandFill, effectiveConfig, fillLook, levelLooks, lineLook, seriesPoints } from '../indicator-style'

const candles: Candle[] = [
  { time: 1, open: 10, high: 12, low: 9, close: 11, volume: 100 }, // up
  { time: 2, open: 11, high: 12, low: 9, close: 10, volume: 200 }, // down
  { time: 3, open: 10, high: 12, low: 9, close: 10, volume: 300 }, // flat counts as up
]

describe('effectiveConfig', () => {
  it("takes an indicator's values from the account and the rest from this device", () => {
    const device = { ...DEFAULT_CONFIG, ema20: 30, rsi: 9 }
    const config = effectiveConfig(device, { rsi: { values: { rsi: 21 } }, macd: { style: { lines: { macd: { width: 2 } } } } })

    expect(config).toEqual({ ...device, rsi: 21 })
    expect(device.rsi).toBe(9)
  })
})

describe('lineLook, nothing saved', () => {
  it("keeps today's color and width 1 for every line of every indicator", () => {
    for (const [key, spec] of Object.entries(INDICATOR_SPECS)) {
      for (const line of spec.lines(candles, DEFAULT_CONFIG)) {
        expect(lineLook(line), `${key}/${line.id}`).toEqual({ color: line.color, width: 1, visible: true, upColor: line.color, downColor: line.color })
      }
    }
    expect(INDICATOR_SPECS.ema20.lines(candles, DEFAULT_CONFIG)[0].color).toBe(INDICATOR_COLORS.ema20)
  })
})

describe('seriesPoints', () => {
  const [volume] = INDICATOR_SPECS.volume.lines(candles, DEFAULT_CONFIG)

  it('gives histogram bars no color of their own while rising and falling share one (the data of today)', () => {
    expect(seriesPoints(volume, lineLook(volume))).toEqual([{ time: 1, value: 100 }, { time: 2, value: 200 }, { time: 3, value: 300 }])
  })

  it("colors each volume bar by its candle: up (or flat) in the rising color, down in the falling one", () => {
    const look = lineLook(volume, { upColor: '#089981', downColor: '#f23645' })
    expect(seriesPoints(volume, look).map((p) => 'color' in p && p.color)).toEqual(['#089981', '#f23645', '#089981'])
  })

  it('colors a MACD bar rising when it is higher than the one before, falling when lower', () => {
    const many: Candle[] = Array.from({ length: 80 }, (_, i) => ({ time: i, open: 100, high: 101, low: 99, close: 100 + Math.sin(i / 6) * 5, volume: 1 }))
    const histogram = INDICATOR_SPECS.macd.lines(many, DEFAULT_CONFIG).find((l) => l.id === 'histogram')!
    const points = seriesPoints(histogram, lineLook(histogram, { upColor: '#0f0', downColor: '#f00' }))

    points.forEach((p, i) => {
      if (i === 0) return
      const rising = p.value >= points[i - 1].value
      expect('color' in p && p.color, `bar ${i}`).toBe(rising ? '#0f0' : '#f00')
    })
    expect(new Set(points.map((p) => 'color' in p && p.color))).toEqual(new Set(['#0f0', '#f00']))
  })
})

describe('levelLooks', () => {
  it("RSI's levels are 30 and 70 in the theme's color until the user changes them", () => {
    expect(levelLooks('rsi', undefined, '#222')).toEqual([{ value: 30, color: '#222', visible: true }, { value: 70, color: '#222', visible: true }])
  })

  it('a saved level moves and takes its color; the other stays', () => {
    expect(levelLooks('rsi', { levels: [{ value: 30 }, { value: 80, color: '#f23645' }] }, '#222')).toEqual([
      { value: 30, color: '#222', visible: true },
      { value: 80, color: '#f23645', visible: true },
    ])
  })
})

describe('fillLook', () => {
  it('is off by default, as there was no fill before', () => {
    expect(fillLook('bands').visible).toBe(false)
    expect(fillLook('levels').visible).toBe(false)
  })
})

/** A canvas context that records what it was asked to paint. */
function recordingContext() {
  const calls: unknown[][] = []
  const ctx = new Proxy({ globalAlpha: 1, fillStyle: '' } as Record<string, unknown>, {
    get: (t, k) => (k in t ? t[k as string] : (...a: unknown[]) => { calls.push([k, ...a]) }),
    set: (t, k, v) => { t[k as string] = v; calls.push([`set ${String(k)}`, v]); return true },
  })
  return { ctx, calls }
}
function attach(fill: BandFill, priceToCoordinate: (p: number) => number | null) {
  const requestUpdate = vi.fn()
  fill.attached({
    chart: { timeScale: () => ({ timeToCoordinate: (t: number) => t * 10 }) },
    series: { priceToCoordinate },
    requestUpdate,
  } as never)
  return requestUpdate
}
function paint(fill: BandFill) {
  const { ctx, calls } = recordingContext()
  const renderer = fill.paneViews()[0].renderer()
  renderer?.draw({ useMediaCoordinateSpace: (f: (s: unknown) => void) => f({ context: ctx, mediaSize: { width: 400, height: 300 } }) } as never)
  return { drawn: renderer !== null, calls }
}

describe('BandFill', () => {
  it('draws nothing while off', () => {
    const fill = new BandFill()
    attach(fill, (p) => 300 - p)
    fill.update({ visible: false, color: '#2962ff', transparency: 90, top: 70, bottom: 30 })

    expect(paint(fill).drawn).toBe(false)
  })

  it('fills between two levels across the pane, in its color with its transparency, under the lines', () => {
    const fill = new BandFill()
    const requestUpdate = attach(fill, (p) => 300 - p)
    fill.update({ visible: true, color: '#7e57c2', transparency: 80, top: 70, bottom: 30 })

    expect(requestUpdate).toHaveBeenCalled()
    expect(fill.paneViews()[0].zOrder?.()).toBe('bottom')
    const { calls } = paint(fill)
    expect(calls).toContainEqual(['set fillStyle', '#7e57c2'])
    expect(calls.find(([k]) => k === 'set globalAlpha')![1]).toBeCloseTo(0.2)
    expect(calls).toContainEqual(['fillRect', 0, 230, 400, 40])
  })

  it('fills between two bands: along the upper one and back along the lower one', () => {
    const fill = new BandFill()
    attach(fill, (p) => 300 - p)
    const upper = [{ time: 1, value: 20 }, { time: 2, value: 22 }]
    const lower = [{ time: 1, value: 10 }, { time: 2, value: 12 }]
    fill.update({ visible: true, color: '#2962ff', transparency: 90, top: upper, bottom: lower })

    const path = paint(fill).calls.filter(([k]) => k === 'moveTo' || k === 'lineTo')
    expect(path).toEqual([['moveTo', 10, 280], ['lineTo', 20, 278], ['lineTo', 20, 288], ['lineTo', 10, 290]])
  })
})
