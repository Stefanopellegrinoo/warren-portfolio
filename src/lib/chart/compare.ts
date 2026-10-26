import type { Candle, Timeframe } from '@/lib/binance/types'
import { closeOnOrBefore } from '@/lib/daily-bars'
import type { SeriesPoint } from '@/lib/compare-series'
import { toChartTime } from './timeframes'

/** Comparisons are daily data: they are drawn on daily, weekly and monthly charts only. */
export const COMPARE_TIMEFRAMES: Timeframe[] = ['1d', '1w', '1M']

/**
 * A daily series on the main chart's bars: each bar takes the last daily value before the next
 * bar starts (the last bar, the latest one). Bars before the series starts get no point.
 */
export function alignToBars(barTimes: number[], daily: SeriesPoint[]): { time: number; value: number }[] {
  const out: { time: number; value: number }[] = []
  let j = 0
  let last: number | null = null
  barTimes.forEach((time, i) => {
    const end = i + 1 < barTimes.length ? barTimes[i + 1] : Infinity
    while (j < daily.length && toChartTime(daily[j].time) < end) last = daily[j++].value
    if (last !== null) out.push({ time, value: last })
  })
  return out
}

const dayOf = (time: number) => new Date(time * 1000).toISOString().slice(0, 10)

/** A peso chart in USD: every price divided by the CCL on or before its day; candles before the first CCL dropped. */
export function toUsdCandles(candles: Candle[], ccl: SeriesPoint[]): Candle[] {
  const rates = ccl.map((r) => ({ date: r.time, close: r.value }))
  const out: Candle[] = []
  for (const c of candles) {
    const rate = closeOnOrBefore(rates, dayOf(c.time))
    if (rate === null || !(rate > 0)) continue
    out.push({ ...c, open: c.open / rate, high: c.high / rate, low: c.low / rate, close: c.close / rate })
  }
  return out
}

/** Today's change of the stocks held: each position's change weighted by its market value. */
export function portfolioDayChangePct(positions: { market_value?: number; day_change_pct?: number }[]): number | null {
  let value = 0
  let weighted = 0
  for (const p of positions) {
    const v = p.market_value ?? 0
    value += v
    weighted += v * (p.day_change_pct ?? 0)
  }
  return value > 0 ? weighted / value : null
}

/**
 * The % a series moved from the base day (`from`, or its first bar) to the bar pointed at (`at`, or
 * its last bar); a bar before the base day reads its change against that day too. Null when there
 * is nothing to read.
 */
export function pctFrom(points: { time: number; value: number }[], from: number | null, at: number | null): number | null {
  const base = points.find((p) => from === null || p.time >= from)
  const target = at === null ? points.at(-1) : points.findLast((p) => p.time <= at)
  if (!base || !target || !(base.value > 0)) return null
  return (target.value / base.value - 1) * 100
}

/** How far back the comparison starts: every line is at 0 % on that day. */
export type CompareRange = '1M' | '3M' | '6M' | 'YTD' | '1A' | 'Todo'
export const COMPARE_RANGES: CompareRange[] = ['1M', '3M', '6M', 'YTD', '1A', 'Todo']
const MONTHS_BACK: Partial<Record<CompareRange, number>> = { '1M': 1, '3M': 3, '6M': 6, '1A': 12 }

/** The first day of `range`, in chart seconds, counted back from the last bar; null for Todo (no limit). */
export function rangeStart(range: CompareRange, last: number): number | null {
  if (range === 'Todo') return null
  const d = new Date(last * 1000)
  if (range === 'YTD') return Date.UTC(d.getUTCFullYear(), 0, 1) / 1000
  // Months back, on the same day, or the last day of a shorter month (Mar 31 − 1M = Feb 28).
  const month = d.getUTCMonth() - MONTHS_BACK[range]!
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), month + 1, 0)).getUTCDate()
  return Date.UTC(d.getUTCFullYear(), month, Math.min(d.getUTCDate(), lastDay)) / 1000
}

/**
 * The bar every line starts from, fixed: the one that closes right before the range starts (its
 * close is where the range begins: Dec 31 for YTD, December's bar on a monthly chart), and never
 * before the first bar on which the chart and every compared series have a value. It moves only
 * with the range, never with the view, so panning or zooming the chart never changes a number.
 */
export function compareBase(
  bars: { time: number; close: number }[],
  lines: { time: number; value: number }[][],
  range: CompareRange,
): { index: number; time: number; close: number } | null {
  if (bars.length === 0) return null
  const firsts = lines.filter((l) => l.length > 0).map((l) => l[0].time)
  const common = bars.findIndex((b) => b.time >= Math.max(bars[0].time, ...firsts))
  if (common < 0) return null
  const start = rangeStart(range, bars[bars.length - 1].time)
  const inRange = start === null ? 0 : bars.findIndex((b) => b.time >= start)
  const index = Math.max(common, inRange < 0 ? bars.length - 1 : inRange - 1)
  return { index, time: bars[index].time, close: bars[index].close }
}

/**
 * A compared series in the chart's own units, from the base day on: it reads `close` that day and
 * moves by its own % from there. Drawn on the price scale like that, every line starts at the same
 * point, and the chart's indicators, drawings and alerts keep their prices. Before the base day the
 * comparison has not started, so nothing is drawn there: zoomed out, only the chart's own series shows.
 */
export function scaleToBase(points: { time: number; value: number }[], time: number, close: number): { time: number; value: number }[] {
  const start = points.findIndex((p) => p.time >= time)
  const base = points[start]
  if (!base || !(base.value > 0)) return []
  return points.slice(start).map((p) => ({ time: p.time, value: (p.value / base.value) * close }))
}
