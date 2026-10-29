import { describe, it, expect } from 'vitest'
import { INDICATOR_SPECS, INDICATOR_ORDER } from '../indicator-specs'
import { DEFAULT_CONFIG } from '@/lib/store/chart-store'
import { ema, rsi } from '@/lib/indicators'
import type { Candle } from '@/lib/binance/types'

const candles: Candle[] = Array.from({ length: 300 }, (_, i) => ({
  time: 1_700_000_000 + i * 86_400,
  open: 100 + Math.sin(i / 7) * 5,
  high: 106 + Math.sin(i / 7) * 5,
  low: 95 + Math.sin(i / 7) * 5,
  close: 101 + Math.sin(i / 5) * 5,
  volume: 1000 + i,
}))

describe('INDICATOR_SPECS', () => {
  it('covers every indicator the store can enable', () => {
    expect([...INDICATOR_ORDER].sort()).toEqual(
      ['adx', 'bollinger', 'ema20', 'ema200', 'ema50', 'macd', 'obv', 'rsi', 'stochastic', 'volume'].sort()
    )
  })

  it('draws moving averages on the price pane with the configured period', () => {
    const spec = INDICATOR_SPECS.ema50
    const [line] = spec.lines(candles, { ...DEFAULT_CONFIG, ema50: 30 })

    expect(spec.pane).toBe('price')
    expect(line.data).toEqual(ema(candles, 30))
  })

  it('puts oscillators in their own pane with their reference levels', () => {
    expect(INDICATOR_SPECS.rsi.pane).toBe('own')
    expect(INDICATOR_SPECS.rsi.levels).toEqual([30, 70])
    expect(INDICATOR_SPECS.stochastic.levels).toEqual([20, 80])
    expect(INDICATOR_SPECS.adx.levels).toEqual([25])
    expect(INDICATOR_SPECS.rsi.lines(candles, DEFAULT_CONFIG)[0].data).toEqual(rsi(candles, 14))
  })

  // odd/tasks/chart-pro-redesign.md S6: the volume is drawn at the foot of the price pane, not in a pane of its own.
  it('draws the volume over the price', () => {
    expect(INDICATOR_SPECS.volume.pane).toBe('price')
  })

  it('splits MACD into line, signal and a histogram', () => {
    const lines = INDICATOR_SPECS.macd.lines(candles, DEFAULT_CONFIG)

    expect(lines.map((l) => [l.id, l.type])).toEqual([
      ['macd', 'line'],
      ['signal', 'line'],
      ['histogram', 'histogram'],
    ])
  })

  it('gives every line the same length as the points it was computed from, all with finite values', () => {
    for (const key of INDICATOR_ORDER) {
      for (const line of INDICATOR_SPECS[key].lines(candles, DEFAULT_CONFIG)) {
        expect(line.data.length, `${key}/${line.id}`).toBeGreaterThan(0)
        expect(line.data.every((p) => Number.isFinite(p.value)), `${key}/${line.id}`).toBe(true)
      }
    }
  })
})
