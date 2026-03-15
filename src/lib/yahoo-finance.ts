/**
 * Standalone Yahoo Finance quote fetcher
 * Redis cache (if available) → in-memory cache → Yahoo Finance direct
 */

import { getRedis, isRedisReady } from './redis'
import type { Quote } from '@/types'
import { getCCLRate } from './currency'

// ── In-memory price cache (fallback when Redis is unavailable) ──
interface CacheEntry {
  quote: Quote
  timestamp: number
}

const memoryCache = new Map<string, CacheEntry>()
const MEMORY_CACHE_TTL_MS = 60_000     // 60 seconds
const REDIS_CACHE_PREFIX = 'stock-quote:'
const REDIS_CACHE_TTL = 300            // 5 minutes

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

// ── Fetch from Yahoo Finance directly ───────────────────
export async function fetchQuotesFromYahoo(tickers: string[]): Promise<Map<string, Quote>> {
  const quotesMap = new Map<string, Quote>()
  if (!tickers.length) return quotesMap

  try {
    const yahooFinance = await getYahooFinance()

    const symbolToTicker = new Map<string, string>()
    const symbols = tickers.map(ticker => {
      const symbol = normalizeTickerForYahoo(ticker)
      symbolToTicker.set(symbol, ticker)
      return symbol
    })

    const quotes: any[] = await yahooFinance.quote(symbols, {}, { return: 'array' })

    // 3. Normalized Prices (USD)
    const ccl = await getCCLRate()

    for (const quote of quotes) {
      if (quote?.regularMarketPrice) {
        const ticker = symbolToTicker.get(quote.symbol)
        if (ticker) {
          let price = quote.regularMarketPrice
          let change = quote.regularMarketChange ?? 0
          
          // If it's Argentine stock, convert ARS -> USD
          if (ticker.startsWith('BCBA:')) {
            price = price / ccl
            change = change / ccl
          }

          quotesMap.set(ticker, {
            ticker,
            price,
            change,
            changePercent: (quote.regularMarketChangePercent ?? 0) / 100,
            previousClose: quote.regularMarketPreviousClose ?? quote.regularMarketPrice,
          })
        }
      }
    }
  } catch (err) {
    console.error('[Yahoo Finance] Error fetching quotes:', err)
  }

  return quotesMap
}

// ── Cache a quote in Redis ──────────────────────────────
export async function cachePrice(ticker: string, quote: Quote): Promise<void> {
  // Always update memory cache
  setMemoryCachedQuote(ticker, quote)

  // Try Redis if available
  if (isRedisReady()) {
    try {
      const redis = getRedis()
      if (redis) {
        await redis.setex(`${REDIS_CACHE_PREFIX}${ticker}`, REDIS_CACHE_TTL, JSON.stringify(quote))
      }
    } catch {
      // Redis write failed — memory cache is still valid
    }
  }
}

// ── Main entry: Redis → memory cache → Yahoo Finance ───
/**
 * Fetch quotes for a list of tickers.
 * Priority: Redis cache → in-memory cache → Yahoo Finance direct.
 * Never throws — returns partial results on failure.
 */
export async function fetchQuotes(tickers: string[]): Promise<Map<string, Quote>> {
  const quotesMap = new Map<string, Quote>()
  if (!tickers.length) return quotesMap

  const unique = Array.from(new Set(tickers))
  const missing: string[] = []

  // 1. Try Redis cache first
  if (isRedisReady()) {
    try {
      const redis = getRedis()
      if (redis) {
        const keys = unique.map(t => `${REDIS_CACHE_PREFIX}${t}`)
        const cached = await redis.mget(...keys)
        unique.forEach((ticker, i) => {
          if (cached[i]) {
            try {
              const quote = JSON.parse(cached[i]!) as Quote
              quotesMap.set(ticker, quote)
              setMemoryCachedQuote(ticker, quote) // sync memory cache
            } catch {
              // Parse error
              missing.push(ticker)
            }
          } else {
            missing.push(ticker)
          }
        })
      } else {
        missing.push(...unique)
      }
    } catch {
      missing.push(...unique)
    }
  } else {
    // Redis not available — check memory cache
    for (const ticker of unique) {
      const cached = getMemoryCachedQuote(ticker)
      if (cached !== null) {
        quotesMap.set(ticker, cached)
      } else {
        missing.push(ticker)
      }
    }
  }

  // 2. Fetch missing from Yahoo Finance directly
  if (missing.length > 0) {
    const yahooResult = await fetchQuotesFromYahoo(missing)
    const entries = Array.from(yahooResult.entries())
    for (let i = 0; i < entries.length; i++) {
      const [ticker, quote] = entries[i]
      quotesMap.set(ticker, quote)
      // Cache for next time
      await cachePrice(ticker, quote)
    }
  }

  return quotesMap
}

// ── Historical Data Fetching (Caching array for 1h) ───────────
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
  
  // Try to hit Redis cache first (1 hour TTL)
  const cachedData = await getCachedRoute<HistoricalQuote[]>(cacheKey)
  if (cachedData) {
    return cachedData
  }

  try {
    const yahooFinance = await getYahooFinance()
    const symbol = normalizeTickerForYahoo(ticker)
    
    // 2. Fetch from Yahoo
    const result = await yahooFinance.historical(symbol, {
      period1,
      period2,
      interval: '1d'
    })

    // 3. Normalize to USD if it's Argentine stock
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
    
    await cacheRoute(cacheKey, parsed, 86400) // cache for 24 hours
    
    return parsed
  } catch (err) {
    console.error(`[Yahoo Finance] Error fetching historical data for ${ticker}:`, err)
    return []
  }
}
