/** A bar as Yahoo's chart() returns it: any leg can be null. */
export interface ChartBar {
  date: Date
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume?: number | null
}

export interface ChartResult {
  quotes: ChartBar[]
  meta?: { regularMarketPrice?: number; regularMarketTime?: Date | string | number }
}

export type CompleteBar = ChartBar & { open: number; high: number; low: number; close: number }

const isoDay = (d: Date) => d.toISOString().slice(0, 10)

/**
 * The complete bars of a chart() answer. historical() rejected a whole series when one bar had some null
 * values — Yahoo sends today's bar without its close, so every daily chart and signal failed (2026-11-03).
 * Today's bar takes the live price as its close (same day only); any other incomplete bar is dropped.
 */
export function completeBars({ quotes, meta }: ChartResult): CompleteBar[] {
  const live = meta?.regularMarketPrice
  const last = quotes.at(-1)
  const liveDay = meta?.regularMarketTime != null ? isoDay(new Date(meta.regularMarketTime)) : null
  const bars = last && last.close == null && last.open != null && typeof live === 'number' && liveDay === isoDay(last.date)
    ? [...quotes.slice(0, -1), { ...last, close: live, high: Math.max(last.high ?? live, live), low: Math.min(last.low ?? live, live) }]
    : quotes
  return bars.filter((q): q is CompleteBar => q.open != null && q.high != null && q.low != null && q.close != null)
}

export type YahooInterval = '15m' | '1h' | '1d' | '1wk' | '1mo'

const HOUR = 3_600_000
// How long after a bar starts a later point is still inside it. Daily and weekly bars start at the exchange's
// midnight or open, which moves an hour in UTC with the US clock changes: the limits keep clear of the next bar
// (the next one can start 23 h after a daily open, 7 d − 1 h after a weekly one) and still reach a 24/7 series' late points.
const INSIDE_MS: Record<Exclude<YahooInterval, '1mo'>, number> = { '15m': 15 * 60_000, '1h': HOUR, '1d': 22 * HOUR, '1wk': 7 * 24 * HOUR - 2 * HOUR }
const QUARTER_HOUR_MS = 15 * 60_000

// The last trade may sit on the period's very end (a 21:00:00 closing auction ends the 20:45 bar): it still belongs to it.
const inside = (bar: Date, point: Date, interval: YahooInterval, edgeIncluded = false) => interval === '1mo'
  ? bar.getUTCFullYear() === point.getUTCFullYear() && bar.getUTCMonth() === point.getUTCMonth()
  : point.getTime() - bar.getTime() < INSIDE_MS[interval] + (edgeIncluded ? 1 : 0)

// Intraday bars start on a quarter hour (1h extended-hours bars sit 30 min from the session's): a point on
// one is a bar. The live point carries the last trade's own time (11:16:19).
const onBarStart = (point: Date, interval: YahooInterval) =>
  (interval === '15m' || interval === '1h') && point.getTime() % QUARTER_HOUR_MS === 0

const highest = (...xs: (number | null)[]) => Math.max(...xs.filter((x): x is number => x != null))
const lowest = (...xs: (number | null)[]) => Math.min(...xs.filter((x): x is number => x != null))

/**
 * Yahoo appends the last trade as a loose point after the current bar: a second candle with one day's
 * prices on weekly and monthly charts, a sliver at 11:16:19 on 15m (odd/tasks/chart-display.md S3, S5).
 * A trailing point inside the previous bar's period is folded into it: its price is that bar's close and
 * its range widens the bar's. The bar keeps its volume, which counts the trade; a week or month bar that
 * still closes elsewhere has not counted that session yet (Yahoo builds some from completed days only) and
 * adds the point's, and a bar without volume takes it. A point without a price is dropped, and so is a 15m/1h
 * live point whose bar Yahoo has not drawn yet. A bar of a new period, a point on an intraday bar start
 * (unless it is the last trade), or a padding bar is never folded.
 * ponytail: "closes elsewhere" reads a lagging period bar; one that lags at the very same price keeps its volume.
 */
export function foldLivePoint<B extends ChartBar>(quotes: B[], interval: YahooInterval, lastTrade?: Date | string | number): B[] {
  const last = quotes.at(-1)
  const prev = quotes.at(-2)
  if (!last) return quotes
  // Yahoo's own last trade time (meta.regularMarketTime) marks the live point even on a quarter hour (a 21:00:00 close).
  // ponytail: a real post-market 21:00 bar that is still the last one also matches, for its first 15 minutes.
  const isLastTrade = lastTrade != null && new Date(lastTrade).getTime() === last.date.getTime()
  // Off the 15m/1h grid a point can only be the live point. In a period's first seconds Yahoo has no bar
  // for it yet (12:00:28 after the 11:45 bar): it waits for that bar, with the next poll, instead of a sliver.
  const offGrid = (interval === '15m' || interval === '1h') && !onBarStart(last.date, interval)
  // A padding bar (no prices: chart() fills gaps with them) is no bar to fold into.
  if (!prev || prev.open == null || !inside(prev.date, last.date, interval, isLastTrade)) return offGrid ? quotes.slice(0, -1) : quotes
  if (onBarStart(last.date, interval) && !isLastTrade) return quotes
  if (last.close == null) return quotes.slice(0, -1)
  const lagging = (interval === '1wk' || interval === '1mo') && prev.close !== last.close
  const volume = prev.volume == null ? last.volume : lagging ? prev.volume + (last.volume ?? 0) : prev.volume
  return [...quotes.slice(0, -2), {
    ...prev,
    close: last.close,
    high: highest(prev.high, last.high, last.close),
    low: lowest(prev.low, last.low, last.close),
    volume,
  }]
}
