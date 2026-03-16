/**
 * BullMQ Price Worker
 *
 * Run with: npm run worker
 *
 * Listens for price update jobs and fetches quotes from Yahoo Finance,
 * storing them in Redis for fast dashboard access.
 *
 * Two job types:
 * - 'update-prices': fetch specific tickers (on-demand)
 * - 'update-all-prices': fetch ALL positions for ALL users (repeatable)
 */

import { Worker } from 'bullmq'
import { PRICE_QUEUE_NAME, scheduleRepeatingPriceJob } from './queue'
import { fetchQuotesFromYahoo, cachePrice, fetchQuotes } from './yahoo-finance'
import { createClient } from '@supabase/supabase-js'
import { calculatePortfolioSummary } from './portfolio-engine'
import { getRedis } from './redis'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

// Service client for fetching all user positions
function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.warn('[Worker] Supabase not configured — cannot fetch all positions')
    return null
  }
  return createClient(url, key)
}

/**
 * Fetch all distinct tickers across all users
 */
async function getAllTickers(): Promise<string[]> {
  const supabase = getSupabase()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('positions')
    .select('ticker')

  if (error) {
    console.error('[Worker] Error fetching positions:', error)
    return []
  }

  const tickerSet = new Set((data || []).map((p: any) => p.ticker))
  return Array.from(tickerSet)
}

// ── Worker ──────────────────────────────────────────────
const worker = new Worker(
  PRICE_QUEUE_NAME,
  async (job) => {
    let tickers: string[] = []

    if (job.name === 'update-all-prices') {
      tickers = await getAllTickers()
      if (!tickers.length) {
        console.log('[Worker] No positions found — skipping')
        return
      }
    } else {
      // On-demand job: specific tickers
      tickers = (job.data as { tickers: string[] }).tickers || []
    }

    console.log(`[Worker] Fetching ${tickers.length} tickers: ${tickers.join(', ')}`)

    // 1. TRY YAHOO FINANCE (fresh data)
    let yahooPrices = new Map<string, any>()
    try {
      yahooPrices = await fetchQuotesFromYahoo(tickers)
      console.log(`[Worker] Yahoo returned ${yahooPrices.size}/${tickers.length} prices`)
    } catch (err) {
      console.error('[Worker] Yahoo fetch failed:', err)
    }

    // 2. CACHE fresh prices to Redis LKP
    const cacheEntries = Array.from(yahooPrices.entries())
    for (let i = 0; i < cacheEntries.length; i++) {
      const [ticker, quote] = cacheEntries[i]
      await cachePrice(ticker, quote)
      console.log(`  ✓ ${ticker}: $${quote.price.toFixed(2)}`)
    }

    // 3. BUILD COMPLETE PRICE MAP (Yahoo fresh + LKP fallback)
    // This ensures summaries always have ALL prices, even if Yahoo partially failed
    const allPrices = new Map<string, any>()
    
    // First load existing LKP from Redis
    const lkpPrices = await fetchQuotes(tickers)
    lkpPrices.forEach((quote, ticker) => allPrices.set(ticker, quote))
    
    // Then overwrite with fresh Yahoo data
    yahooPrices.forEach((quote, ticker) => allPrices.set(ticker, quote))
    
    const missing = tickers.filter(t => !allPrices.has(t))
    if (missing.length > 0) {
      console.warn(`[Worker] No price available for: ${missing.join(', ')}`)
    }

    console.log(`[Worker] Done — ${yahooPrices.size} fresh, ${allPrices.size - yahooPrices.size} from LKP, ${missing.length} missing`)

    // 4. UPDATE GLOBAL TIMESTAMP
    const redis = getRedis()
    if (redis) {
      await redis.set('system:last-refresh', new Date().toISOString())
    }

    // 5. CACHE USER SUMMARIES
    await cacheUserSummaries(allPrices)
  },
  {
    connection: { url: REDIS_URL },
    concurrency: 1,
  }
)

worker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.name} (${job.id}) completed`)
})

worker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job?.name} (${job?.id}) failed: ${err.message}`)
})

// ── Start ───────────────────────────────────────────────
async function main() {
  console.log('[Worker] Price update worker started')
  console.log(`[Worker] Redis: ${REDIS_URL}`)

  // Schedule repeating job every 5 minutes
  await scheduleRepeatingPriceJob(5)

  // Also do an immediate fetch on startup
  const tickers = await getAllTickers()
  if (tickers.length) {
    console.log(`[Worker] Initial fetch for ${tickers.length} tickers...`)
    try {
      const prices = await fetchQuotesFromYahoo(tickers)
      const initEntries = Array.from(prices.entries())
      for (let i = 0; i < initEntries.length; i++) {
        const [ticker, quote] = initEntries[i]
        await cachePrice(ticker, quote)
      }
      console.log(`[Worker] Initial fetch done — ${prices.size} prices cached`)
      
      // Build complete map for summaries (same logic as job)
      const allPrices = new Map<string, any>()
      prices.forEach((q, t) => allPrices.set(t, q))
      
      const redis = getRedis()
      if (redis) {
        await redis.set('system:last-refresh', new Date().toISOString())
      }
      
      await cacheUserSummaries(allPrices)
    } catch (err) {
      console.error('[Worker] Initial fetch failed — will retry on next cycle:', err)
    }
  }
}

/**
 * For every user with active positions, calculates and caches their summary in Redis.
 * This makes the Dashboard sub-10ms.
 */
async function cacheUserSummaries(quotes: Map<string, any>) {
  if (quotes.size === 0) {
    console.log('[Worker] No prices available — skipping summary cache')
    return
  }

  console.log('[Worker] Caching user summaries...')
  const supabase = getSupabase()
  if (!supabase) return

  // 1. Get all positions across all users
  const { data: allPositions } = await supabase.from('positions').select('*')
  if (!allPositions) return

  // 2. Get all closed trades (to calculate realized pnl)
  const { data: allClosed } = await supabase.from('closed_trades').select('user_id, pnl')

  // Group positions by user
  const userPositions = new Map<string, any[]>()
  allPositions.forEach(p => {
    const list = userPositions.get(p.user_id) || []
    list.push(p)
    userPositions.set(p.user_id, list)
  })

  // Group closed pnl by user
  const userRealized = new Map<string, number>()
  ;(allClosed || []).forEach(t => {
    const current = userRealized.get(t.user_id) || 0
    userRealized.set(t.user_id, current + (t.pnl || 0))
  })

  const redis = getRedis()
  if (!redis) return

  // 3. Process each user
  const users = Array.from(userPositions.keys())
  for (const userId of users) {
    const positions = userPositions.get(userId) || []
    const realized = userRealized.get(userId) || 0

    const { positions: enriched, summary } = calculatePortfolioSummary(positions, quotes, realized)
    
    // Cache the full payload that /api/positions expects
    const payload = JSON.stringify({ positions: enriched, summary })
    await redis.setex(`summary:${userId}`, 600, payload)
  }

  console.log(`[Worker] Cached summaries for ${users.length} users.`)
}

main().catch(console.error)
