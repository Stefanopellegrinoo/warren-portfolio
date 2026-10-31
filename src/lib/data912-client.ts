/**
 * data912.com API Client for Argentine Corporate Bonds (ONs Corporativas)
 * 
 * API endpoint: https://data912.com/live/arg_corp
 * No authentication required.
 *
 * USO DIRECTO - SIN IOL NI MAPPINGS COMPLEJOS
 */

import type { Quote } from '@/types'
import { fetchQuotes, cachePrice } from './yahoo-finance'
import { createServiceClient } from './supabase-server'
import { localSymbol } from './multicurrency'

export interface Data912RawQuote {
  symbol: string
  c: number           // last price (inconsistent format — see normalizePriceToUSD)
  pct_change: number  // percentage change (0.53 = 0.53%, not 53%)
  q_bid: number
  px_bid: number
  px_ask: number
  q_ask: number
  v: number
  q_op: number
}

/**
 * Data912 API returns prices ALREADY multiplied by 100 for Dollar-MEP bonds.
 * 
 * Examples:
 * - CS50D = 104.65 (not 1.0465)
 * - AERBD = 102.85 (not 1.0285)
 * - MGCRD = 97.50 (not 0.9750)
 * 
 * NO CONVERSION NEEDED for Dollar-MEP bonds (ticker ends with 'D').
 * We store and compare prices in this same format (×100).
 */
function normalizePriceToUSD(rawPrice: number): number {
  return rawPrice  // NO CONVERSION — already in ×100 format
}

// A hung data912 must not hold a request (or a worker run) open forever (S5).
const DATA912_TIMEOUT_MS = 8_000

/**
 * Fetch ALL corporate bond quotes from data912.com
 */
export async function fetchAllData912Quotes(signal: AbortSignal = AbortSignal.timeout(DATA912_TIMEOUT_MS)): Promise<Data912RawQuote[]> {
  try {
    const response = await fetch('https://data912.com/live/arg_corp', {
      signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Warren Portfolio/1.0'
      }
    })

    if (!response.ok) {
      throw new Error(`Data912 API error: ${response.status}`)
    }

    const data = await response.json()
    
    if (!Array.isArray(data)) {
      throw new Error('Data912 API returned non-array response')
    }

    return data
  } catch (error) {
    console.error('[Data912] Failed to fetch quotes:', error)
    throw error
  }
}

/**
 * Fetch a single corporate bond quote
 */
export async function fetchData912Price(ticker: string): Promise<Quote | null> {
  const upperTicker = ticker.toUpperCase().trim()
  
  // Only accept Dollar-MEP bonds (ticker ends with 'D')
  if (!upperTicker.endsWith('D')) {
    console.warn(`[Data912] Skipping ${upperTicker} — ONs must end with 'D' for Dollar-MEP`)
    return null
  }
  
  try {
    const allQuotes = await fetchAllData912Quotes()
    const rawQuote = allQuotes.find(q => q.symbol === upperTicker)

    if (!rawQuote) {
      console.warn(`[Data912] Ticker ${upperTicker} not found`)
      return null
    }

    const price = normalizePriceToUSD(rawQuote.c)
    // Quote.changePercent is a FRACTION everywhere (0.005 = 0.5%). data912
    // reports percent units, so divide — all LKP writers share one convention.
    const changePercent = rawQuote.pct_change / 100
    const change = price * changePercent // absolute change in USD
    const previousClose = price - change

    return {
      ticker: rawQuote.symbol,
      price,
      change,
      changePercent,
      previousClose,
      updatedAt: new Date().toISOString()
    }
  } catch (err) {
    console.error(`[Data912] Failed to fetch ${upperTicker}:`, err)
    return null
  }
}

/**
 * Fetch multiple corporate bond quotes
 */
export async function fetchData912Prices(tickers: string[]): Promise<Map<string, Quote>> {
  if (tickers.length === 0) return new Map()

  console.log(`[Data912] Fetching ${tickers.length} tickers: ${tickers.join(', ')}`)

  try {
    const allQuotes = await fetchAllData912Quotes()
    const quotes = new Map<string, Quote>()

    for (const ticker of tickers) {
      const upperTicker = ticker.toUpperCase().trim()
      
      // Only accept Dollar-MEP bonds (ticker ends with 'D')
      if (!upperTicker.endsWith('D')) {
        console.warn(`[Data912] Skipping ${upperTicker} — ONs must end with 'D' for Dollar-MEP`)
        continue
      }
      
      const rawQuote = allQuotes.find(q => q.symbol === upperTicker)

      if (rawQuote) {
        const price = normalizePriceToUSD(rawQuote.c)
        // FRACTION convention (0.005 = 0.5%) — see fetchData912Price.
        const changePercent = rawQuote.pct_change / 100
        const change = price * changePercent // absolute change in USD
        const previousClose = price - change

        quotes.set(upperTicker, {
          ticker: rawQuote.symbol,
          price,
          change,
          changePercent,
          previousClose,
          updatedAt: new Date().toISOString()
        })
      } else {
        console.warn(`[Data912] Ticker ${upperTicker} not found`)
      }
    }

    console.log(`[Data912] Got ${quotes.size}/${tickers.length} quotes`)
    return quotes
  } catch (err) {
    console.error('[Data912] Failed to fetch quotes:', err)
    return new Map()
  }
}

/**
 * Get available corporate bond tickers from data912.com
 */
export async function getAvailableCorporateBonds(): Promise<string[]> {
  try {
    const allQuotes = await fetchAllData912Quotes()
    return allQuotes.map(item => item.symbol)
  } catch (error) {
    console.error('[Data912] Failed to fetch available bonds:', error)
    return []
  }
}

// ── Peso-line prices (CEDEARs and local shares) ─────────────────────────────

export const LOCAL_FEEDS = {
  cedears: 'https://data912.com/live/arg_cedears',
  stocks: 'https://data912.com/live/arg_stocks',
} as const
const LOCAL_FETCH_TIMEOUT_MS = 10_000

/**
 * Last-known-price name of a peso-line price. It goes through the same helpers
 * as every other price (cachePrice / fetchQuotes), so in Redis it is
 * `price:local:{SYMBOL}`.
 */
export const localPriceKey = (symbol: string) => `local:${symbol}`

/** Every row of one peso-line feed: one GET with the client's timeout. Throws on a failed or non-array answer. */
export async function fetchLocalFeed(url: string, fetchFn: typeof fetch): Promise<Data912RawQuote[]> {
  const res = await fetchFn(url, {
    signal: AbortSignal.timeout(LOCAL_FETCH_TIMEOUT_MS),
    headers: { 'Accept': 'application/json', 'User-Agent': 'Warren Portfolio/1.0' },
  })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const rows = await res.json()
  if (!Array.isArray(rows)) throw new Error(`${url}: non-array response`)
  return rows
}

/**
 * Caches the peso-line close (`c`) and day change of the held tickers: one GET
 * per feed. A CEDEAR is looked up by its own ticker in the CEDEAR feed, a
 * `BCBA:` share by its symbol in the stocks feed. Never throws: a failed feed is
 * logged and its symbols keep their last-known price. Returns how many prices
 * were cached.
 */
export async function refreshLocalPrices(tickers: string[], fetchFn: typeof fetch = fetch): Promise<number> {
  const wanted = { cedears: new Set<string>(), stocks: new Set<string>() }
  for (const t of tickers) {
    const isShare = t.trim().toUpperCase().startsWith('BCBA:')
    wanted[isShare ? 'stocks' : 'cedears'].add(localSymbol(t))
  }
  const kinds = (Object.keys(wanted) as (keyof typeof wanted)[]).filter(k => wanted[k].size > 0)
  if (kinds.length === 0) return 0

  const feeds = await Promise.allSettled(kinds.map(k => fetchLocalFeed(LOCAL_FEEDS[k], fetchFn)))
  const updatedAt = new Date().toISOString()
  let cached = 0

  for (let i = 0; i < kinds.length; i++) {
    const feed = feeds[i]
    if (feed.status === 'rejected') {
      console.error(`[Data912] ${kinds[i]} peso prices failed, last-known prices kept:`, feed.reason)
      continue
    }
    for (const r of feed.value) {
      const price = Number(r.c)
      if (!wanted[kinds[i]].has(r.symbol) || !(price > 0)) continue
      // FRACTION convention (0.005 = 0.5%), as every LKP writer.
      const changePercent = Number(r.pct_change) / 100 || 0
      const previousClose = price / (1 + changePercent)
      await cachePrice(localPriceKey(r.symbol), {
        ticker: r.symbol, price, change: price - previousClose, changePercent, previousClose, updatedAt,
      })
      cached++
    }
  }
  return cached
}

/**
 * Alias for fetchData912Prices - for consistency with ONs terminology
 */
export const fetchONQuotes = fetchData912Prices

/**
 * Fetch ON quotes with a three-tier fallback chain.
 * - 1. Redis LKP (Last Known Price) — no network call when worker has cached prices
 * - 2. Data912 for cache misses
 * - 3. `ons.last_price` from the DB for tickers STILL missing after 1 and 2 —
 *      degraded Quote (change/changePercent = 0), stale price > no price.
 *      Never overwrites a live/LKP quote; DB errors degrade gracefully.
 */
export async function fetchONQuotesWithFallback(tickers: string[]): Promise<Map<string, Quote>> {
  if (!tickers.length) return new Map()

  // 1. Try Redis LKP first — no network call when worker has cached prices
  const quotesMap = await fetchQuotes(tickers)

  const missingTickers = tickers.filter(t => !quotesMap.has(t))
  if (missingTickers.length === 0) return quotesMap

  // 2. Fetch missing from Data912
  try {
    const freshQuotes = await fetchData912Prices(missingTickers)
    freshQuotes.forEach((quote, ticker) => {
      quotesMap.set(ticker, quote)
      cachePrice(ticker, quote).catch(e => console.error(`[Data912] Cache error for ${ticker}:`, e))
    })
  } catch (err) {
    console.warn('[Data912] External fetch failed — returning LKP for missing tickers:', missingTickers.join(', '))
  }

  // 3. DB fallback — last persisted price from `ons` for anything STILL missing
  const stillMissing = tickers.filter(t => !quotesMap.has(t))
  if (stillMissing.length > 0) {
    // The `ons` table stores uppercase tickers, but tiers 1 & 2 key quotesMap by
    // the caller's original casing — map UPPERCASE → original so the key contract
    // holds. If two inputs uppercase-collide, first wins.
    const upperToOriginal = new Map<string, string>()
    for (const ticker of stillMissing) {
      const upper = ticker.toUpperCase()
      if (!upperToOriginal.has(upper)) upperToOriginal.set(upper, ticker)
    }

    try {
      const supabase = createServiceClient()
      const { data, error } = await supabase
        .from('ons')
        .select('ticker, last_price, last_updated')
        .in('ticker', [...upperToOriginal.keys()])

      if (error) {
        console.warn('[Data912] DB fallback query failed:', error)
      } else {
        for (const row of data ?? []) {
          // A persisted 0 (or null/undefined/NaN) means "no price", not a $0 quote
          if (!(Number(row.last_price) > 0)) continue

          const originalTicker = upperToOriginal.get(String(row.ticker).toUpperCase())
          if (!originalTicker) continue
          if (quotesMap.has(originalTicker)) continue

          const stalePrice = Number(row.last_price)
          quotesMap.set(originalTicker, {
            ticker: originalTicker,
            price: stalePrice,
            change: 0,
            changePercent: 0,
            previousClose: stalePrice,
            updatedAt: row.last_updated ?? undefined
          })
          console.log(`[Data912] DB fallback: ${originalTicker} @ ${stalePrice} (stale)`)
        }
      }
    } catch (err) {
      console.warn('[Data912] DB fallback failed — returning what we have:', err)
    }
  }

  return quotesMap
}