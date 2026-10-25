import { ema, rsi, macd, bollinger, obv, stochastic, adx, type IndicatorPoint } from '@/lib/indicators'
import { INDICATOR_COLORS, type IndicatorConfig, type IndicatorKey } from '@/lib/store/chart-store'
import type { Candle } from '@/lib/binance/types'

export interface IndicatorLine {
  id: string
  type: 'line' | 'histogram'
  color: string
  data: IndicatorPoint[]
  /** A histogram's bars that rise (true) or fall, for its two colors (S5). */
  up?: boolean[]
}

export interface IndicatorSpec {
  label: (c: IndicatorConfig) => string
  /** 'price' overlays the candles; 'own' gets a pane below them. */
  pane: 'price' | 'own'
  levels?: number[]
  lines: (candles: Candle[], c: IndicatorConfig) => IndicatorLine[]
}

const line = (id: string, color: string, data: IndicatorPoint[]): IndicatorLine => ({ id, type: 'line', color, data })
const pick = <T extends { time: number }>(points: T[], f: (p: T) => number): IndicatorPoint[] =>
  points.map((p) => ({ time: p.time, value: f(p) }))

const SIGNAL = '#e0904a'
const MUTED = '#8f887e'

const emaSpec = (key: 'ema20' | 'ema50' | 'ema200'): IndicatorSpec => ({
  label: (c) => `EMA ${c[key]}`,
  pane: 'price',
  lines: (candles, c) => [line(key, INDICATOR_COLORS[key], ema(candles, c[key]))],
})

export const INDICATOR_SPECS: Record<IndicatorKey, IndicatorSpec> = {
  ema20: emaSpec('ema20'),
  ema50: emaSpec('ema50'),
  ema200: emaSpec('ema200'),
  bollinger: {
    label: (c) => `BB ${c.bbPeriod} ${c.bbStdDev}`,
    pane: 'price',
    lines: (candles, c) => {
      const b = bollinger(candles, c.bbPeriod, c.bbStdDev)
      return [
        line('upper', INDICATOR_COLORS.bollinger, pick(b, (p) => p.upper)),
        line('middle', MUTED, pick(b, (p) => p.middle)),
        line('lower', INDICATOR_COLORS.bollinger, pick(b, (p) => p.lower)),
      ]
    },
  },
  volume: {
    label: () => 'Volumen',
    pane: 'own',
    lines: (candles) => [{
      id: 'volume', type: 'histogram', color: INDICATOR_COLORS.volume,
      data: candles.map((k) => ({ time: k.time, value: k.volume })),
      up: candles.map((k) => k.close >= k.open),
    }],
  },
  rsi: {
    label: (c) => `RSI ${c.rsi}`,
    pane: 'own',
    levels: [30, 70],
    lines: (candles, c) => [line('rsi', INDICATOR_COLORS.rsi, rsi(candles, c.rsi))],
  },
  macd: {
    label: (c) => `MACD ${c.macdFast} ${c.macdSlow} ${c.macdSignal}`,
    pane: 'own',
    lines: (candles, c) => {
      const m = macd(candles, c.macdFast, c.macdSlow, c.macdSignal)
      const bars = pick(m, (p) => p.histogram)
      return [
        line('macd', INDICATOR_COLORS.macd, pick(m, (p) => p.macd)),
        line('signal', SIGNAL, pick(m, (p) => p.signal)),
        // A bar rises when it is higher than the one before it (TradingView's "grow").
        { id: 'histogram', type: 'histogram', color: MUTED, data: bars, up: bars.map((p, i) => i === 0 || p.value >= bars[i - 1].value) },
      ]
    },
  },
  stochastic: {
    label: (c) => `Estocástico ${c.stochK} ${c.stochSmooth} ${c.stochD}`,
    pane: 'own',
    levels: [20, 80],
    lines: (candles, c) => {
      const s = stochastic(candles, c.stochK, c.stochSmooth, c.stochD)
      return [line('k', INDICATOR_COLORS.stochastic, pick(s, (p) => p.k)), line('d', SIGNAL, pick(s, (p) => p.d))]
    },
  },
  adx: {
    label: (c) => `ADX ${c.adxPeriod}`,
    pane: 'own',
    levels: [25],
    lines: (candles, c) => {
      const a = adx(candles, c.adxPeriod)
      return [
        line('adx', INDICATOR_COLORS.adx, pick(a, (p) => p.adx)),
        line('plusDI', '#3f8c45', pick(a, (p) => p.plusDI)),
        line('minusDI', '#c8382a', pick(a, (p) => p.minusDI)),
      ]
    },
  },
  obv: {
    label: () => 'OBV',
    pane: 'own',
    lines: (candles) => [line('obv', INDICATOR_COLORS.obv, obv(candles))],
  },
}

/** Draw order: price overlays first, then panes top to bottom. */
export const INDICATOR_ORDER: IndicatorKey[] = ['ema20', 'ema50', 'ema200', 'bollinger', 'volume', 'rsi', 'macd', 'stochastic', 'adx', 'obv']
