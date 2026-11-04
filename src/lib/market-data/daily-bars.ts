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
// midnight or open, which moves an hour in UTC with the US clock changes: the limits keep clear of the next bar.
const INSIDE_MS: Record<Exclude<YahooInterval, '1mo'>, number> = { '15m': 15 * 60_000, '1h': HOUR, '1d': 20 * HOUR, '1wk': 6 * 24 * HOUR }

const inside = (bar: Date, point: Date, interval: YahooInterval) => interval === '1mo'
  ? bar.getUTCFullYear() === point.getUTCFullYear() && bar.getUTCMonth() === point.getUTCMonth()
  : point.getTime() - bar.getTime() < INSIDE_MS[interval]

const highest = (...xs: (number | null)[]) => Math.max(...xs.filter((x): x is number => x != null))
const lowest = (...xs: (number | null)[]) => Math.min(...xs.filter((x): x is number => x != null))

/**
 * Yahoo appends the last trade as a loose point after the current bar: a second candle with one day's
 * prices on weekly and monthly charts, a sliver at 11:16:19 on 15m (odd/tasks/chart-display.md S3, S5).
 * A trailing point inside the previous bar's period is folded into it: its price is that bar's close, its
 * range widens the bar's, the bar's volume stays (it already counts the trade). A point without a price is
 * dropped. A bar of a new period, or a padding bar without prices, is never folded into.
 */
export function foldLivePoint<B extends ChartBar>(quotes: B[], interval: YahooInterval): B[] {
  const last = quotes.at(-1)
  const prev = quotes.at(-2)
  // A padding bar (no prices: chart() fills gaps with them) is no bar to fold into.
  if (!last || !prev || prev.open == null || !inside(prev.date, last.date, interval)) return quotes
  if (last.close == null) return quotes.slice(0, -1)
  return [...quotes.slice(0, -2), {
    ...prev,
    close: last.close,
    high: highest(prev.high, last.high, last.close),
    low: lowest(prev.low, last.low, last.close),
  }]
}
