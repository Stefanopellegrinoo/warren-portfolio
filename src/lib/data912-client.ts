/**
 * data912.com API Client for Argentine Corporate Bonds (ONs Corporativas)
 * 
 * API endpoint: https://data912.com/live/arg_corp
 * No authentication required.
 *
 * USO DIRECTO - SIN IOL NI MAPPINGS COMPLEJOS
 */

import type { Quote } from '@/types'

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
 * Normalizes data912 price to USD.
 * 
 * Data912 API returns prices in TWO different formats:
 * - Tickers ending in "O" (e.g., CS50O): Price in CENTAVOS (152000 = $1,520.00)
 * - Tickers ending in "D" (e.g., AERBD): Price as % of $1000 nominal (102.85 = $1,028.50)
 * 
 * Heuristic (empirically validated):
 * - If price > 1000 → divide by 100 (centavos to USD)
 * - If price <= 1000 → multiply by 10 (% nominal to USD, assuming $1000 nominal)
 */
function normalizePriceToUSD(rawPrice: number): number {
  if (rawPrice > 1000) {
    return rawPrice / 100  // centavos → USD
  } else {
    return rawPrice * 10   // % of $1000 nominal → USD
  }
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