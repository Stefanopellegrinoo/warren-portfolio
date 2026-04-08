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
import { fetchData912Prices } from './data912-client'
import { createServiceClient } from './supabase-server'
import { calculatePortfolioSummary } from './portfolio-engine'
import { getRedis } from './redis'
import { isMarketOpen } from './utils'
import { startImportWorker } from './import-worker'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
console.log(REDIS_URL)

let supabaseInstance: any = null

function getSupabase() {
  if (!supabaseInstance) {
    try {
      supabaseInstance = createServiceClient()
    } catch (err) {
      console.warn('[Worker] Supabase not configured — cannot fetch all positions', err)
      return null
    }
  }
  return supabaseInstance
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

  const tickerSet = new Set((data || []).map((p: any) => p.ticker) as string[])
  return Array.from(tickerSet)
}

/**
 * Fetch all ON tickers from the ons table (ones users are trading)
 */
async function getAllONTickers(): Promise<string[]> {
  const supabase = getSupabase()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('ons')
    .select('ticker')

  if (error) {
    console.error('[Worker] Error fetching ONs from database:', error)
    return []
  }

  const tickerSet = new Set((data || []).map((p: any) => p.ticker) as string[])
  return Array.from(tickerSet)
}

/**
 * Update last_price in ons table after fetching from Data912
 */
async function updateONPricesInDatabase(prices: Map<string, any>): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return

  const updates = Array.from(prices.entries()).map(([ticker, quote]) => ({
    ticker,
    last_price: quote.price,
    last_updated: new Date().toISOString()
  }))

  if (updates.length === 0) return

  try {
    // Use upsert to update existing records
    const { error } = await supabase
      .from('ons')
      .upsert(updates, { onConflict: 'ticker' })

    if (error) {
      console.error('[Worker] Failed to update ON prices in database:', error)
    } else {
      console.log(`[Worker] Updated ${updates.length} ON prices in database`)
    }
  } catch (err) {
    console.error('[Worker] Error updating ON prices:', err)
  }
}


// ── Worker ──────────────────────────────────────────────
const worker = new Worker(
  PRICE_QUEUE_NAME,
  async (job) => {
    let tickers: string[] = []

    if (job.name === 'update-all-prices') {
      if (!isMarketOpen()) {
        console.log('[Worker] Market is closed — skipping periodic fetch cycle')
        return
      }
      
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

    // 5. FETCH ON PRICES FROM IOL (if configured)
    let onPrices = new Map<string, any>()
    if (job.name === 'update-all-prices') {
      const onTickers = await getAllONTickers()
      if (onTickers.length) {
        try {
          onPrices = await fetchData912Prices(onTickers)
          // Update database with latest prices
          await updateONPricesInDatabase(onPrices)
        } catch (err) {
          console.error('[Worker] Data912 fetch failed in job cycle:', err)
        }
      }
    }

    // 6. CACHE USER SUMMARIES
    await cacheUserSummaries(allPrices, onPrices)
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
  startImportWorker()
  console.log(`[Worker] Redis: ${REDIS_URL}`)

  // Schedule repeating job every 5 minutes
  await scheduleRepeatingPriceJob(5)

  // Immediate fetch on startup
  const [tickers, onTickers] = await Promise.all([getAllTickers(), getAllONTickers()])

  try {
    // Fetch stock prices from Yahoo
    const allPrices = new Map<string, any>()
    if (tickers.length) {
      console.log(`[Worker] Initial stock fetch for ${tickers.length} tickers...`)
      const prices = await fetchQuotesFromYahoo(tickers)
      const entries = Array.from(prices.entries())
      for (let i = 0; i < entries.length; i++) {
        const [ticker, quote] = entries[i]
        await cachePrice(ticker, quote)
      }
      prices.forEach((q, t) => allPrices.set(t, q))
      console.log(`[Worker] Stock prices cached: ${prices.size}`)
    }

    // Fetch ON prices from Data912
    let onPrices = new Map<string, any>()
    if (onTickers.length) {
      console.log(`[Worker] Initial ON fetch for ${onTickers.length} tickers via Data912...`)
      try {
        onPrices = await fetchData912Prices(onTickers)
        console.log(`[Worker] Data912 ON prices cached: ${onPrices.size}`)
        // Update database with latest prices
        await updateONPricesInDatabase(onPrices)
      } catch (err) {
        console.error('[Worker] Data912 fetch failed on startup:', err)
      }
    }

    const redis = getRedis()
    if (redis) await redis.set('system:last-refresh', new Date().toISOString())

    await cacheUserSummaries(allPrices, onPrices)
  } catch (err) {
    console.error('[Worker] Initial fetch failed — will retry on next cycle:', err)
  }
}

/**
 * For every user with active positions, calculates and caches their summary in Redis.
 * This makes the Dashboard sub-10ms.
 * 
 * stockQuotes: prices from Yahoo Finance
 * onQuotes: prices from IOL (may be empty if IOL not configured)
 */
async function cacheUserSummaries(stockQuotes: Map<string, any>, onQuotes: Map<string, any> = new Map()) {
  if (stockQuotes.size === 0 && onQuotes.size === 0) {
    console.log('[Worker] No prices available — skipping summary cache')
    return
  }

  console.log('[Worker] Caching user summaries...')
  const supabase = getSupabase()
  if (!supabase) return

  // 1. Get all positions across all users
  const [stockRes, onRes, closedRes, onClosedRes, cashRes] = await Promise.all([
    supabase.from('positions').select('*'),
    supabase.from('on_positions').select('*'),
    supabase.from('closed_trades').select('user_id, pnl'),
    supabase.from('on_closed_trades').select('user_id, pnl'),
    supabase.from('cash_balance').select('user_id, balance'),
  ])

  const allPositions = stockRes.data ?? []
  const allONPositions = onRes.data ?? []

  // Group by user
  const userStocks = new Map<string, any[]>()
  allPositions.forEach((p: any) => {
    const list = userStocks.get(p.user_id) || []
    list.push(p)
    userStocks.set(p.user_id, list)
  })

  const userONs = new Map<string, any[]>()
  allONPositions.forEach((p: any) => {
    const list = userONs.get(p.user_id) || []
    list.push(p)
    userONs.set(p.user_id, list)
  })

  const userRealized = new Map<string, number>()
  ;(closedRes.data || []).forEach((t: any) => {
    userRealized.set(t.user_id, (userRealized.get(t.user_id) || 0) + (t.pnl || 0))
  })

  const userONRealized = new Map<string, number>()
  ;(onClosedRes.data || []).forEach((t: any) => {
    userONRealized.set(t.user_id, (userONRealized.get(t.user_id) || 0) + (t.pnl || 0))
  })

  const userCash = new Map<string, number>()
  ;(cashRes.data || []).forEach((b: any) => {
    userCash.set(b.user_id, b.balance || 0)
  })

  const redis = getRedis()
  if (!redis) return

  // All users that have ANY position (stocks or ONs)
  const allUsers = Array.from(new Set([...Array.from(userStocks.keys()), ...Array.from(userONs.keys())]))

  for (const userId of allUsers) {
    const isImporting = await redis.get(`importing:${userId}`)
    if (isImporting) {
      console.log(`[Worker] Skipping summary cache for ${userId} — import in progress`)
      continue
    }

    const positions = userStocks.get(userId) || []
    const onPositions = userONs.get(userId) || []
    const realized = userRealized.get(userId) || 0
    const onRealized = userONRealized.get(userId) || 0
    const cashBalance = userCash.get(userId) || 0

    const { positions: enriched, onPositions: enrichedONs, summary } = calculatePortfolioSummary(
      positions,
      onPositions,
      stockQuotes,
      onQuotes,
      cashBalance,
      realized,
      onRealized
    )

    const payload = JSON.stringify({ positions: enriched, onPositions: enrichedONs, summary })
    await redis.setex(`summary:${userId}`, 600, payload)
  }

  console.log(`[Worker] Cached summaries for ${allUsers.length} users (stocks + ONs + cash).`)
}

main().catch(console.error)
