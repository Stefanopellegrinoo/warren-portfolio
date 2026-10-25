import { formatNumber } from '../utils'
import { DEFAULT_CONFIG, type IndicatorConfig, type IndicatorKey } from '../store/chart-store'
import type { Timeframe } from '@/lib/binance/types'
import { INDICATOR_SPECS } from './indicator-specs'
import { indicatorOf, isPriceValue, lineIdOf, type AlertCondition, type AlertStatus } from './alert-condition'

/** The two ways the quick alert and a dragged line watch the price: up to a line above it, down to one below. */
export type AlertOperator = 'crosses_above' | 'crosses_below'

export interface ChartAlert extends AlertCondition {
  id: string
  ticker: string
  name: string
  status: AlertStatus
  /** null: the chart's accent, as every alert had before colors. */
  color: string | null
}

const HIT_TOLERANCE_PX = 6

/** The decimals the chart's price axis shows: four under 1 (a coin), two otherwise. */
export const priceDecimals = (price: number) => (Math.abs(price) < 1 ? 4 : 2)

/** The alert line under the pointer, or null. Lines off the price range are skipped. */
export function hitTestAlert(
  alerts: readonly { id: string; value: number }[],
  y: number,
  priceToY: (price: number) => number | null,
  tolerance = HIT_TOLERANCE_PX
): string | null {
  let best: string | null = null
  let bestDist = tolerance + 1
  for (const a of alerts) {
    const ay = priceToY(a.value)
    if (ay === null) continue
    const dist = Math.abs(ay - y)
    if (dist <= tolerance && dist < bestDist) {
      best = a.id
      bestDist = dist
    }
  }
  return best
}

/** A line above the price waits for the price to rise through it, and the mirror. */
export function operatorFor(value: number, lastPrice: number): AlertOperator {
  return value > lastPrice ? 'crosses_above' : 'crosses_below'
}

export function alertName(ticker: string, operator: AlertOperator, value: number): string {
  return `${ticker} cruza por ${operator === 'crosses_above' ? 'encima' : 'debajo'} de ${formatNumber(value, { decimals: priceDecimals(value) })}`
}

// ── Conditions in words (odd/tasks/chart-customization.md S6) ────────────────

// A line after its indicator's label ("BB 20 2 superior"); a single-line indicator is just its label.
const LINE_NAMES: Record<string, string> = { signal: 'señal', upper: 'superior', middle: 'media', lower: 'inferior', k: '%K', d: '%D', plusDI: '+DI', minusDI: '-DI' }
const FEMININE = new Set<IndicatorKey>(['ema20', 'ema50', 'ema200', 'bollinger'])
const TIMEFRAME_LABELS: Partial<Record<Timeframe, string>> = { '1d': '1D', '1w': '1S', '1M': '1M' }
const WAYS = { crosses_above: 'para arriba', crosses_below: 'para abajo', crosses: 'cualquiera' } as const
const SENTENCE_WAYS = { crosses_above: 'para arriba', crosses_below: 'para abajo', crosses: 'para arriba o para abajo' } as const

export const timeframeLabel = (tf: Timeframe) => TIMEFRAME_LABELS[tf] ?? tf

/** "Precio", or an indicator line with the periods it is computed with: "EMA 50", "RSI 14", "BB 20 2 superior". */
export function lineLabel(line: string, periods: Partial<IndicatorConfig> | null): string {
  if (line === 'price') return 'Precio'
  const key = indicatorOf(line)
  const id = lineIdOf(line)
  const label = INDICATOR_SPECS[key].label({ ...DEFAULT_CONFIG, ...periods })
  return id === key ? label : `${label} ${LINE_NAMES[id] ?? id}`
}

/** A value as the chart shows it: a price with its axis' decimals, an indicator level as typed (70, not 70,00). */
function valueText(value: number, source: string) {
  return formatNumber(value, { decimals: source !== 'price' && Number.isInteger(value) ? 0 : priceDecimals(value) })
}

const targetText = (c: AlertCondition) => (c.target === 'value' ? valueText(c.value ?? 0, c.source) : lineLabel(c.target, c.periods))

/** The condition in a list: an alert from before as it always read ("Supera 195,00"), a new one in full. */
export function conditionText(c: AlertCondition): string {
  if (isPriceValue(c) && c.operator !== 'crosses' && c.value !== null) {
    return `${c.operator === 'crosses_above' ? 'Supera' : 'Baja de'} ${valueText(c.value, 'price')}`
  }
  const tf = c.timeframe ? ` (${timeframeLabel(c.timeframe)})` : ''
  return `${lineLabel(c.source, c.periods)} cruza ${targetText(c)}${tf} · ${WAYS[c.operator]}`
}

/** A line with its article, inside a sentence: "el precio", "la EMA 50", "el RSI 14". */
function inSentence(line: string, periods: Partial<IndicatorConfig> | null) {
  if (line === 'price') return 'el precio'
  return `${FEMININE.has(indicatorOf(line)) ? 'la' : 'el'} ${lineLabel(line, periods)}`
}

/** The sheet's sentence: "Te avisa una vez cuando el precio de FXI cruce la EMA 50, para arriba o para abajo." */
export function restate(ticker: string, c: AlertCondition): string {
  const target = c.target === 'value' ? valueText(c.value ?? 0, c.source) : inSentence(c.target, c.periods)
  return `Te avisa una vez cuando ${inSentence(c.source, c.periods)} de ${ticker} cruce ${target}, ${SENTENCE_WAYS[c.operator]}.`
}

/** The stored name: today's for the price against a value up or down, the ticker and the words otherwise. */
export function conditionName(ticker: string, c: AlertCondition): string {
  if (isPriceValue(c) && c.operator !== 'crosses' && c.value !== null) return alertName(ticker, c.operator, c.value)
  return `${ticker}: ${conditionText(c)}`
}
