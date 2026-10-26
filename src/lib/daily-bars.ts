/** Daily closes, with no fetching: safe for the client bundle (historical-prices.ts reaches Yahoo). */
export interface DailyBar {
  /** YYYY-MM-DD */
  date: string
  close: number
}

/**
 * The close on `date`, else the most recent close before it.
 *
 * Carries the last price forward across weekends and holidays. Returns null —
 * never 0 — when the series starts after `date`, because a 0 would report a
 * -100% crash for every day before an ETF existed.
 */
export function closeOnOrBefore(bars: DailyBar[], date: string): number | null {
  let best: DailyBar | null = null
  for (const bar of bars) {
    if (bar.date <= date && (!best || bar.date > best.date)) best = bar
  }
  return best ? best.close : null
}
