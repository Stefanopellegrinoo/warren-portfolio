import type { Candle, Timeframe } from '@/lib/binance/types'
import { closeOnOrBefore } from '@/lib/historical-prices'
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
 * The % a series moved from the first bar in sight (`from`, or its first bar) to the bar pointed at
 * (`at`, or its last bar): what the % scale reads for it. Null when there is nothing to read.
 */
export function pctFrom(points: { time: number; value: number }[], from: number | null, at: number | null): number | null {
  const base = points.find((p) => from === null || p.time >= from)
  const target = at === null ? points.at(-1) : points.findLast((p) => p.time <= at)
  if (!base || !target || target.time < base.time || !(base.value > 0)) return null
  return (target.value / base.value - 1) * 100
}
