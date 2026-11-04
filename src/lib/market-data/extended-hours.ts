/** A stock's extended-hours trading, as TradingView shows it (odd/tasks/extended-hours.md S1). */
export type ExtendedSession = 'pre' | 'post'

export interface ExtendedHours {
  session: ExtendedSession
  price: number
  /** Against the regular session's close, in percent units (−6.95 = −6,95 %), as Yahoo sends it. */
  changePercent: number
}

/** The fields of Yahoo's quote() this reads. */
export interface YahooExtendedFields {
  regularMarketTime?: Date
  preMarketPrice?: number
  preMarketChangePercent?: number
  preMarketTime?: Date
  postMarketPrice?: number
  postMarketChangePercent?: number
  postMarketTime?: Date
}

/**
 * The extended session traded after the regular session's last trade, the later one when both were:
 * before the open the pre-market, after the close and overnight the post-market, none during the session.
 */
export function extendedHours(q: YahooExtendedFields): ExtendedHours | null {
  const regular = q.regularMarketTime?.getTime()
  if (regular == null) return null
  const sessions = [
    { session: 'pre' as const, price: q.preMarketPrice, changePercent: q.preMarketChangePercent, at: q.preMarketTime?.getTime() },
    { session: 'post' as const, price: q.postMarketPrice, changePercent: q.postMarketChangePercent, at: q.postMarketTime?.getTime() },
  ]
  const latest = sessions
    .filter((s) => s.price != null && s.changePercent != null && s.at != null && s.at > regular)
    .sort((a, b) => b.at! - a.at!)[0]
  return latest ? { session: latest.session, price: latest.price!, changePercent: latest.changePercent! } : null
}
