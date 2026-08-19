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

/** @internal — exported for use by market-data providers only */
export async function getYahooFinanceInstance(): Promise<any> {
  return getYahooFinance()
}

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
      
      let yahooResults: any[] = []
      try {
        // Quote with proper options object (not array)
        yahooResults = await yahooFinance.quote(normalizedBatch, {
          fields: ['regularMarketPrice', 'regularMarketChange', 'regularMarketChangePercent']
        })
      } catch (batchError) {
        console.error(`[Quote Fetch] Batch fetch failed for ${batch.join(', ')}. Retrying individually...`)
        // Fallback: fetch individually to isolate bad tickers
        for (const ticker of batch) {
          try {
            const result = await yahooFinance.quote(normalizeTickerForYahoo(ticker), {
              fields: ['regularMarketPrice', 'regularMarketChange', 'regularMarketChangePercent']
            })
            yahooResults.push(result)
          } catch (individualError) {
            console.error(`[Quote Fetch] Individual fetch failed for ${ticker}:`, individualError)
            yahooResults.push(null)
          }
        }
      }
      
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
      
      // Convert ARS→USD for any BCBA tickers in this batch
      const batchHasBCBA = batch.some(t => t.startsWith('BCBA:'))
      let ccl = 0
      if (batchHasBCBA) {
        try { ccl = await getCCLRate() } catch { ccl = 0 }
      }

      // Process batch results
      const now = new Date()
      for (let j = 0; j < batch.length; j++) {
        const ticker = batch[j]
        const result = yahooResults[j]

        if (result && result.regularMarketPrice !== undefined) {
          let price = result.regularMarketPrice
          let change = result.regularMarketChange || 0

          // BCBA prices from Yahoo are in ARS — convert to USD
          if (ticker.startsWith('BCBA:') && ccl > 0) {
            price = price / ccl
            change = change / ccl
          }

          const quote: Quote = {
            ticker,
            price,
            change,
            // FRACTION, like fetchRawQuotes: Yahoo reports percent units and
            // this path caches into the SAME LKP keys as the worker — two
            // units under one key showed day changes 100× off.
            changePercent: (result.regularMarketChangePercent ?? 0) / 100,
            previousClose: price - change,
            updatedAt: now.toISOString()
          }

          // Add to map (always — even if CCL was unavailable)
          quotesMap.set(ticker, quote)

          // Only cache in Redis if the price is in USD.
          // BCBA tickers without CCL would store ARS prices as USD, corrupting the LKP.
          const isBCBAWithoutCCL = ticker.startsWith('BCBA:') && ccl === 0
          if (!isBCBAWithoutCCL) {
            await cacheQuoteInRedis(ticker, quote)
            console.log(`[Quote Fetch] Successfully cached ${ticker}: ${quote.price}`)
          } else {
            console.warn(`[Quote Fetch] Skipping Redis cache for ${ticker} — CCL unavailable, price is in ARS`)
          }
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
  // The requested range is part of the identity: a range-less key served the
  // FIRST caller's window to every subsequent request for 24h — a user asking
  // for 2 years got whatever range happened to be cached first.
  const cacheKey = `historical:${ticker}:${period1.toISOString().split('T')[0]}`
  
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
        // No `if (rate)` fall-through here. A missing rate used to leave the
        // price in ARS and hand it back as USD — roughly 1000x inflated, written
        // into whatever consumed the series. Silence is the bug; throw instead.
        if (!rate) {
          throw new Error(
            `[Yahoo Finance] No historical CCL rate for ${ticker} on ${dateStr} — refusing to return an ARS price as USD`
          )
        }
        price = price / rate
      }

      return {
        date: dateStr,
        close: price
      }
    })

    await cacheRoute(cacheKey, parsed, 86400)

    return parsed
  } catch (err) {
    if (err instanceof Error && err.message.includes('No historical CCL rate')) throw err
    console.error(`[Yahoo Finance] Error fetching historical data for ${ticker}:`, err)
    return []
  }
}

// ── Klines (OHLCV) Fetching for Charts ───────────────────────────
export interface Kline {
  date:   string   // YYYY-MM-DD
  open:   number
  high:   number
  low:    number
  close:  number
  volume: number
}

/**
 * Fetch full OHLCV data (Klines) from Yahoo Finance.
 * Used primarily by the TradingView-style charts.
 * 
 * - Normalizes ARS prices to USD for BCBA tickers.
 * - Caches results in Redis for 24 hours.
 */
export async function fetchKlines(
  ticker: string,
  interval: '1d' | '1w',
  period1: Date,
  period2: Date = new Date()
): Promise<Kline[]> {
  const cacheKey = `klines:${ticker}:${interval}`
  
  // 1. Try Redis cache
  const cachedData = await getCachedRoute<Kline[]>(cacheKey)
  if (cachedData) return cachedData

  try {
    const yahooFinance = await getYahooFinance()
    const symbol = normalizeTickerForYahoo(ticker)
    
    // Map interval to Yahoo Finance format
    const yfInterval = interval === '1w' ? '1wk' : '1d'

    const result = await yahooFinance.historical(symbol, {
      period1,
      period2,
      interval: yfInterval
    })

    // 2. Normalize to USD if it's Argentine stock (BCBA)
    let hCcl: Map<string, number> | null = null
    if (ticker.startsWith('BCBA:')) {
      hCcl = await getHistoricalCCL(period1, period2)
    }

    const parsed: Kline[] = result.map((row: any) => {
      const dateStr = row.date.toISOString().split('T')[0]
      let open = row.open
      let high = row.high
      let low = row.low
      let close = row.close
      
      if (hCcl) {
        const rate = hCcl.get(dateStr)
        // Same rule as fetchHistoricalQuotes above and the market-data Yahoo
        // provider. An `if (rate)` fall-through left the WHOLE candle in pesos
        // and handed it back as USD — roughly 1000x high — so the signal engine
        // read a phantom breakout on a day the CCL series simply had a gap.
        // The message keeps the `No historical CCL rate` prefix the catch below
        // re-throws on; without that guard this refusal would be swallowed into
        // an empty array, which is the silence the throw exists to break.
        if (!rate) {
          throw new Error(
            `[Yahoo Finance] No historical CCL rate for ${ticker} on ${dateStr} — refusing to return an ARS candle as USD`
          )
        }
        open = open / rate
        high = high / rate
        low = low / rate
        close = close / rate
      }

      return {
        date: dateStr,
        open,
        high,
        low,
        close,
        volume: row.volume ?? 0
      }
    })
    
    // 3. Cache results (1 day TTL)
    await cacheRoute(cacheKey, parsed, 86400)
    
    return parsed
  } catch (err) {
    if (err instanceof Error && err.message.includes('No historical CCL rate')) throw err
    console.error(`[Yahoo Finance] Error fetching klines for ${ticker}:`, err)
    return []
  }
}
