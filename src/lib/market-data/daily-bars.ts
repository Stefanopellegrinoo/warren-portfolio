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
