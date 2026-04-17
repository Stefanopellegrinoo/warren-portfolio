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

// ── Live Quote Fetching (with on-demand fallback) ───────────────────────────────
/**
 * Fetch live quotes with on-demand Yahoo Finance fallback.
 * This function WILL call Yahoo Finance for missing tickers.
 */
export async function fetchQuotesWithFallback(tickers: string[]): Promise<Map<string, Quote>> {
  console.log(`[Quote Fetch] Starting fetchQuotesWithFallback for ${tickers.length} tickers:`, tickers)
  
  const quotesMap = await fetchQuotes(tickers)  // Get cached quotes
  console.log(`[Quote Fetch] After fetchQuotes, cache hits: ${Array.from(quotesMap.keys()).length}, total requested: ${tickers.length}`)
  
  const missingTickers = tickers.filter(t => !quotesMap.has(t))
  
  if (missingTickers.length === 0) {
    console.log(`[Quote Fetch] All tickers found in cache, returning early`)
    return quotesMap
  }

  console.log(`[Quote Fetch] Missing ${missingTickers.length} tickers, fetching from Yahoo:`, missingTickers)
  console.log(`[Quote Fetch] Normalized tickers:`, missingTickers.map(normalizeTickerForYahoo))
  
  try {
    // Fetch missing tickers from Yahoo Finance (rate limited to 5 per call)
    const BATCH_SIZE = 5
    for (let i = 0; i < missingTickers.length; i += BATCH_SIZE) {
      const batch = missingTickers.slice(i, i + BATCH_SIZE)
      
      const yahooFinance = await getYahooFinance()
      const normalizedBatch = batch.map(normalizeTickerForYahoo)
      
      // Quote with proper options object (not array)
      const yahooResults = await yahooFinance.quote(normalizedBatch, {
        fields: ['regularMarketPrice', 'regularMarketChange', 'regularMarketChangePercent']
      })
      
      console.log(`[Quote Fetch] Yahoo results for batch ${i}/${missingTickers.length}:`, yahooResults)
      // Log each result individually for debugging
      normalizedBatch.forEach((normTicker, idx) => {
        const originalTicker = batch[idx]
        const result = yahooResults[idx]
        if (result && result.regularMarketPrice !== undefined) {
          console.log(`[Quote Fetch] ✓ ${originalTicker} (${normTicker}): $${result.regularMarketPrice}`)
        } else {
          console.log(`[Quote Fetch] ✗ ${originalTicker} (${normTicker}): NO PRICE DATA`, result)
        }
      })
      
      // Process batch results
      const now = new Date()
      for (let j = 0; j < batch.length; j++) {
        const ticker = batch[j]
        const result = yahooResults[j]
        
        if (result && result.regularMarketPrice !== undefined) {
          const quote: Quote = {
            ticker,
            price: result.regularMarketPrice,
            change: result.regularMarketChange || 0,
            changePercent: result.regularMarketChangePercent || 0,
            previousClose: result.regularMarketPrice - (result.regularMarketChange || 0),
            updatedAt: now.toISOString()
          }
          
          // Add to map
          quotesMap.set(ticker, quote)
          
          // Cache in Redis (7 days)
          await cacheQuoteInRedis(ticker, quote)
          console.log(`[Quote Fetch] Successfully cached ${ticker}: ${quote.price}`)
        } else {
          console.warn(`[Quote Fetch] No price data for ${ticker}`, result)
        }
      }
      
      // Small delay between batches to respect rate limits
      if (i + BATCH_SIZE < missingTickers.length) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
  } catch (error) {
    console.error('[Quote Fetch] Error fetching from Yahoo Finance:', error)
    // Don't throw - return partial results with missing tickers
  }
  
  return quotesMap
}

/**
 * Cache a quote in Redis with standard TTL
 */
async function cacheQuoteInRedis(ticker: string, quote: Quote): Promise<void> {
  const redisOk = await ensureRedisConnected()
  if (!redisOk) {
    console.warn(`[Cache] Redis not available, skipping cache for ${ticker}`)
    return
  }
  
  try {
    const redis = getRedis()
    if (redis) {
      await redis.setex(`${PRICE_STORAGE_PREFIX}${ticker}`, PRICE_STORAGE_TTL, JSON.stringify(quote))
      setMemoryCachedQuote(ticker, quote)
      console.log(`[Cache] Cached price for ${ticker}: ${quote.price}`)
    } else {
      console.warn(`[Cache] Redis instance not available for ${ticker}`)
    }
  } catch (err) {
    console.error(`[Cache] Error caching quote for ${ticker}:`, err)
  }
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
