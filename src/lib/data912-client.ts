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

interface Data912RawQuote {
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

/**
 * Fetch ALL corporate bond quotes from data912.com
 */
async function fetchAllData912Quotes(): Promise<Data912RawQuote[]> {
  try {
    const response = await fetch('https://data912.com/live/arg_corp', {
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
    const changePercent = rawQuote.pct_change // already in % format (0.53 = 0.53%)
    const change = price * (changePercent / 100) // absolute change in USD
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
        const changePercent = rawQuote.pct_change // already in % format (0.53 = 0.53%)
        const change = price * (changePercent / 100) // absolute change in USD
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

/**
 * Alias for fetchData912Prices - for consistency with ONs terminology
 */
export const fetchONQuotes = fetchData912Prices

/**
 * Fetch ON quotes with Redis LKP (Last Known Price) fallback.
 * - Tries Redis/memory cache first (no network if cached)
 * - For cache misses, calls Data912
 * - If Data912 fails, returns whatever LKP exists (stale prices > no prices)
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

  return quotesMap
}