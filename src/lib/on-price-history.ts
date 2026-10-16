/**
 * Nightly capture of the WHOLE Data912 Dollar-MEP corporate feed into
 * `on_price_history`, keyed (ticker, price_date). The history of an ON cannot
 * be reconstructed later (Data912 serves only "now"), so every night not
 * captured is lost for good — hence the whole feed, not only held tickers.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllData912Quotes, type Data912RawQuote } from './data912-client'

const CHUNK = 500

/** D-suffixed (Dollar-MEP) rows with a usable price. `c` is stored raw, as quoted. */
export function filterCorporateD(feed: Data912RawQuote[]): Data912RawQuote[] {
  return feed.filter(q => q.symbol?.endsWith('D') && typeof q.c === 'number' && q.c > 0)
}

/**
 * Feed is stale (holiday/weekend) when EVERY ticker repeats the latest stored
 * (close, volume). Tickers with no prior row are ignored; with nothing to
 * compare against we cannot call it stale.
 */
async function isStaleFeed(supabase: SupabaseClient, rows: Data912RawQuote[], date: string): Promise<boolean> {
  const { data: dates, error } = await supabase
    .from('on_price_history')
    .select('price_date')
    .lt('price_date', date)
    .order('price_date', { ascending: false })
    .limit(1)
  if (error) throw new Error(`on_price_history stale check failed: ${error.message}`)
  const prevDate = dates?.[0]?.price_date
  if (!prevDate) return false

  const { data: prev, error: prevError } = await supabase
    .from('on_price_history')
    .select('ticker, close, volume')
    .eq('price_date', prevDate)
  if (prevError) throw new Error(`on_price_history stale check failed: ${prevError.message}`)

  const before = new Map((prev ?? []).map((r: any) => [r.ticker, r]))
  const comparable = rows.filter(q => before.has(q.symbol))
  return comparable.length > 0 && comparable.every(q => {
    const p: any = before.get(q.symbol)
    return Number(p.close) === q.c && Number(p.volume) === q.v
  })
}

/**
 * Upsert today's closes (last-wins). Returns rows written; 0 when the feed is
 * stale. THROWS on fetch/DB failure or an empty feed — callers decide how to alert.
 * Never falls back to Redis LKP: a made-up close is worse than a gap.
 */
export async function captureOnPriceHistory(supabase: SupabaseClient, date: string): Promise<number> {
  const feed = await fetchAllData912Quotes()
  // Last-wins dedupe: a symbol twice in one upsert makes Postgres reject the whole chunk.
  const rows = [...new Map(filterCorporateD(Array.isArray(feed) ? feed : []).map(q => [q.symbol, q])).values()]
  // The job only runs on weekdays and holidays are caught as stale below, so an
  // empty feed is an outage: throw so the caller alerts instead of losing the day.
  if (rows.length === 0) throw new Error('Data912 feed returned no usable ON rows')
  if (await isStaleFeed(supabase, rows, date)) {
    console.warn(`[OnPriceHistory] Feed unchanged vs last stored day — no session, skipping ${date}`)
    return 0
  }

  const capturedAt = new Date().toISOString()
  const payload = rows.map(q => ({
    ticker: q.symbol,
    price_date: date,
    close: q.c,
    bid: q.px_bid > 0 ? q.px_bid : null,
    ask: q.px_ask > 0 ? q.px_ask : null,
    volume: q.v,
    pct_change: q.pct_change,
    captured_at: capturedAt,
    source: 'data912',
  }))

  for (let i = 0; i < payload.length; i += CHUNK) {
    const { error } = await supabase
      .from('on_price_history')
      .upsert(payload.slice(i, i + CHUNK), { onConflict: 'ticker,price_date' })
    if (error) throw new Error(`on_price_history upsert failed: ${error.message}`)
  }
  return payload.length
}
