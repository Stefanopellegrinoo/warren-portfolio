import type { Candle } from '@/lib/binance/types'

const same = (a: Candle, b: Candle) =>
  a.time === b.time && a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close && a.volume === b.volume

/**
 * What a fresh poll changes on the chart: the bars from the last drawn one on
 * that differ, for series.update() in order. Null when the poll does not
 * continue what is drawn (first load, a gap, an empty answer): reload it all.
 */
export function barsToUpdate(drawn: readonly Candle[], polled: readonly Candle[]): Candle[] | null {
  const last = drawn.at(-1)
  if (!last || polled.length === 0) return null
  const from = polled.findIndex((b) => b.time === last.time)
  if (from === -1) return null
  const tail = polled.slice(from)
  return same(tail[0], last) ? tail.slice(1) : tail
}
