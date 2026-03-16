/**
 * Standalone Yahoo Finance quote fetcher
 * Redis LKP (Last Known Price) → in-memory cache → Yahoo Finance direct
 */

import { getRedis, isRedisReady, ensureRedisConnected } from './redis'
import type { Quote } from '@/types'
import { getCCLRate } from './currency'

// ── In-memory price cache (fallback when Redis is unavailable) ──
interface CacheEntry {
  quote: Quote
  timestamp: number
}

const memoryCache = new Map<string, CacheEntry>()
const MEMORY_CACHE_TTL_MS = 120_000    // 2 minutes (generous)
const PRICE_STORAGE_PREFIX = 'price:'
const PRICE_STORAGE_TTL = 604800       // 7 days persistent storage (LKP)

function getMemoryCachedQuote(ticker: string): Quote | null {
  const entry = memoryCache.get(ticker)
  if (!entry) return null
  if (Date.now() - entry.timestamp > MEMORY_CACHE_TTL_MS) {
    memoryCache.delete(ticker)
    return null
  }
  return entry.quote
}

function setMemoryCachedQuote(ticker: string, quote: Quote): void {
  memoryCache.set(ticker, { quote, timestamp: Date.now() })
}

// ── Ticker normalization ────────────────────────────────
export function normalizeTickerForYahoo(ticker: string): string {
  const parts = ticker.split(':')
  if (parts.length === 1) return ticker

  const [exchange, symbol] = parts
  switch (exchange.toUpperCase()) {
    case 'BCBA': return `${symbol}.BA`    // Buenos Aires
    case 'NYSE':
    case 'NASDAQ':
    case 'NYSEARCA':
    case 'AMEX': return symbol
    default: return symbol
  }
}

// ── Yahoo Finance singleton ─────────────────────────────
let yahooInstance: any = null

async function getYahooFinance(): Promise<any> {
  if (yahooInstance) return yahooInstance

  const yahooModule = await import('yahoo-finance2')
  const YahooFinance = (yahooModule as any).default || yahooModule

  const instance = typeof YahooFinance === 'function'
    ? new YahooFinance()
    : YahooFinance

  if (typeof instance.suppressNotices === 'function') {
    instance.suppressNotices(['yahooSurvey'])
  }

  yahooInstance = instance
  return instance
}

// ── Raw Fetch from Yahoo Finance (No ARS→USD normalization) ─────
export async function fetchRawQuotes(tickers: string[]): Promise<Map<string, Quote>> {
  const quotesMap = new Map<string, Quote>()
  if (!tickers.length) return quotesMap

  const yahooFinance = await getYahooFinance()
  const updatedAt = new Date().toISOString()

  const symbolToTicker = new Map<string, string>()
  const symbols = tickers.map(ticker => {
    const symbol = normalizeTickerForYahoo(ticker)
    symbolToTicker.set(symbol, ticker)
    return symbol
  })

  // This will THROW on failure — caller handles retry/fallback
  const quotes: any[] = await yahooFinance.quote(symbols, {}, { return: 'array' })

  for (const quote of quotes) {
    if (quote?.regularMarketPrice) {
      const ticker = symbolToTicker.get(quote.symbol)
      if (ticker) {
        quotesMap.set(ticker, {
          ticker,
          price: quote.regularMarketPrice,
          change: quote.regularMarketChange ?? 0,
          changePercent: (quote.regularMarketChangePercent ?? 0) / 100,
          previousClose: quote.regularMarketPreviousClose ?? quote.regularMarketPrice,
          updatedAt
        })
      }
    }
  }

  return quotesMap
}

// ── Normalized Fetch (Converts ARS to USD via CCL) ──────────────
export async function fetchQuotesFromYahoo(tickers: string[]): Promise<Map<string, Quote>> {
  if (!tickers.length) return new Map()

  try {
    // 1. Fetch RAW data from Yahoo
    const quotesMap = await fetchRawQuotes(tickers)
    
    // 2. Get CCL Rate for ARS→USD normalization (cached in Redis for 1h)
    const hasBCBA = tickers.some(t => t.startsWith('BCBA:'))
    if (hasBCBA) {
      const ccl = await getCCLRate()
      quotesMap.forEach((quote, ticker) => {
        if (ticker.startsWith('BCBA:')) {
          quote.price = quote.price / ccl
          quote.change = quote.change / ccl
        }
      })
    }
    
    return quotesMap
  } catch (err) {
    console.error('[Yahoo Finance] Error in fetchQuotesFromYahoo:', err)
    return new Map()
  }
}

// ── Cache a quote in Redis (LKP) ────────────────────────
export async function cachePrice(ticker: string, quote: Quote): Promise<void> {
  // Always update memory cache
  setMemoryCachedQuote(ticker, quote)

  // Try Redis if available
  if (isRedisReady()) {
    try {
      const redis = getRedis()
      if (redis) {
        await redis.setex(`${PRICE_STORAGE_PREFIX}${ticker}`, PRICE_STORAGE_TTL, JSON.stringify(quote))
      }
    } catch (err) {
      console.error(`[Cache] Error saving price for ${ticker}:`, err)
    }
  }
}

/**
 * Fetch quotes from LKP storage (Redis → Memory).
 * This function NEVER calls Yahoo Finance.
 * It only returns what's already been cached by the Worker.
 */
export async function fetchQuotes(tickers: string[]): Promise<Map<string, Quote>> {
  const quotesMap = new Map<string, Quote>()
  if (!tickers.length) return quotesMap

  const unique = Array.from(new Set(tickers))

  // 1. Try Memory cache first
  const missingFromMem: string[] = []
  unique.forEach(ticker => {
    const cached = getMemoryCachedQuote(ticker)
    if (cached) quotesMap.set(ticker, cached)
    else missingFromMem.push(ticker)
  })

  if (missingFromMem.length === 0) return quotesMap

  // 2. Try Redis LKP storage (ensure connected first)
  const redisOk = await ensureRedisConnected()
  if (redisOk) {
    try {
      const redis = getRedis()
      if (redis) {
        const keys = missingFromMem.map(t => `${PRICE_STORAGE_PREFIX}${t}`)
        const cached = await redis.mget(...keys)
        missingFromMem.forEach((ticker, i) => {
          if (cached[i]) {
            try {
              const quote = JSON.parse(cached[i]!) as Quote
              quotesMap.set(ticker, quote)
              setMemoryCachedQuote(ticker, quote)
            } catch {}
          }
        })
      }
    } catch (err) {
      console.error('[Cache] Error reading from LKP storage:', err)
    }
  }

  return quotesMap
}

// ── Historical Data Fetching ───────────────────────────────
export interface HistoricalQuote {
  date: string // YYYY-MM-DD
  close: number
}

import { getCachedRoute, cacheRoute } from './redis'
import { getHistoricalCCL } from './currency'

export async function fetchHistoricalQuotes(
  ticker: string, 
  period1: Date, 
  period2: Date = new Date()
): Promise<HistoricalQuote[]> {
  const cacheKey = `historical:${ticker}`
  
  // Try to hit Redis cache first
  const cachedData = await getCachedRoute<HistoricalQuote[]>(cacheKey)
  if (cachedData) {
    return cachedData
  }

  try {
    const yahooFinance = await getYahooFinance()
    const symbol = normalizeTickerForYahoo(ticker)
    
    const result = await yahooFinance.historical(symbol, {
      period1,
      period2,
      interval: '1d'
    })

    // Normalize to USD if it's Argentine stock
    let hCcl: Map<string, number> | null = null
    if (ticker.startsWith('BCBA:')) {
      hCcl = await getHistoricalCCL(period1, period2)
    }

    const parsed = result.map((row: any) => {
      const dateStr = row.date.toISOString().split('T')[0]
      let price = row.close
      
      if (hCcl) {
        const rate = hCcl.get(dateStr)
        if (rate) {
          price = price / rate
        }
      }

      return {
        date: dateStr,
        close: price
      }
    })
    
    await cacheRoute(cacheKey, parsed, 86400)
    
    return parsed
  } catch (err) {
    console.error(`[Yahoo Finance] Error fetching historical data for ${ticker}:`, err)
    return []
  }
}
