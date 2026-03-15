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
import { fetchQuotesFromYahoo, cachePrice } from './yahoo-finance'
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

/**
 * Check if the current time is within Buenos Aires market hours
 * Monday to Friday, 10:30 to 17:00 (America/Argentina/Buenos_Aires)
 */
function isMarketOpenBA(): boolean {
  // Get current time in BA timezone
  const now = new Date()
  const options = { timeZone: 'America/Argentina/Buenos_Aires', hour12: false }
  
  const formatter = new Intl.DateTimeFormat('en-US', {
    ...options,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric'
  })
  
  const parts = formatter.formatToParts(now)
  let weekday = '', hourStr = '', minuteStr = ''
  for (const part of parts) {
    if (part.type === 'weekday') weekday = part.value
    if (part.type === 'hour') hourStr = part.value
    if (part.type === 'minute') minuteStr = part.value
  }

  // Check weekday (Mon-Fri)
  if (weekday === 'Sat' || weekday === 'Sun') return false

  // Check hours (10:30 to 17:00)
  const hour = parseInt(hourStr, 10)
  const minute = parseInt(minuteStr, 10)
  const timeNum = hour * 100 + minute

  return timeNum >= 1030 && timeNum < 1700
}

// ── Worker ──────────────────────────────────────────────
const worker = new Worker(
  PRICE_QUEUE_NAME,
  async (job) => {
    let tickers: string[] = []

    if (job.name === 'update-all-prices') {
      // Repeatable job: fetch ALL tickers from all positions
      if (!isMarketOpenBA()) {
        console.log('[Worker] Market is closed in Buenos Aires (Mon-Fri 10:30-17:00). Skipping refresh.')
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

    console.log(`[Worker] Updating ${tickers.length} tickers: ${tickers.join(', ')}`)

    const prices = await fetchQuotesFromYahoo(tickers)

    const entries = Array.from(prices.entries())
    for (let i = 0; i < entries.length; i++) {
      const [ticker, quote] = entries[i]
      await cachePrice(ticker, quote)
      console.log(`  ✓ ${ticker}: $${quote.price}`)
    }

    console.log(`[Worker] Done — ${prices.size}/${tickers.length} prices updated`)

    // Pro-actively cache user summaries
    await cacheUserSummaries(prices)
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

  // Schedule repeating job every 2 minutes
  await scheduleRepeatingPriceJob(2)

  // Also do an immediate fetch on startup
  const tickers = await getAllTickers()
  if (tickers.length) {
    console.log(`[Worker] Initial fetch for ${tickers.length} tickers...`)
    const prices = await fetchQuotesFromYahoo(tickers)
    const initEntries = Array.from(prices.entries())
    for (let i = 0; i < initEntries.length; i++) {
      const [ticker, quote] = initEntries[i]
      await cachePrice(ticker, quote)
    }
    console.log(`[Worker] Initial fetch done — ${prices.size} prices cached`)
    await cacheUserSummaries(prices)
  }
}

/**
 * For every user with active positions, calculates and caches their summary in Redis.
 * This makes the Dashboard sub-10ms.
 */
async function cacheUserSummaries(quotes: Map<string, any>) {
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

  const redis = await getRedis()
  if (!redis) return

  // 3. Process each user
  const users = Array.from(userPositions.keys())
  for (const userId of users) {
    const positions = userPositions.get(userId) || []
    const realized = userRealized.get(userId) || 0

    const { positions: enriched, summary } = calculatePortfolioSummary(positions, quotes, realized)
    
    // Cache the full payload that /api/positions expects
    const payload = JSON.stringify({ positions: enriched, summary })
    await redis.setex(`summary:${userId}`, 3600, payload)
  }

  console.log(`[Worker] Cached summaries for ${users.length} users.`)
}

main().catch(console.error)
