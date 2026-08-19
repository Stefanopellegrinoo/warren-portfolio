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
import { PRICE_QUEUE_NAME, PRICE_REPEAT_JOB_NAME, SNAPSHOT_JOB_NAME, TICKER_AUDIT_JOB_NAME } from './queue'
import { fetchQuotesFromYahoo, cachePrice, fetchQuotes } from './yahoo-finance'
import { fetchData912Prices } from './data912-client'
import { createServiceClient } from './supabase-server'
import { getRedis } from './redis'
import { cacheUserSummaries } from './summary-cache'
import { snapshotAllUsers, splitQuotesByAssetClass } from './portfolio-snapshots'
import { isMarketOpen, argentinaDate } from './utils'
import { startImportWorker } from './import-worker'
import { startSignalsWorker } from './signals-worker'
import { checkNotificationConfig, sendTelegram } from './notifications'
import { ensureRedisAndScheduleJobs, resolveStartupOutcome } from './worker-startup'
import { auditTickerIdentities } from './ticker-audit'

const REDIS_URL = process.env.REDIS_URL


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


/**
 * Evaluate all active price alerts against the latest fetched prices.
 * Uses createServiceClient (RLS bypass) since this runs in the worker.
 * On trigger: marks the alert as 'triggered' and sends a Telegram message.
 */
export async function evaluatePriceAlerts(prices: Record<string, number>): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return

  const tickers = Object.keys(prices)
  if (tickers.length === 0) return

  const { data: alerts, error } = await supabase
    .from('price_alerts')
    .select('*')
    .eq('status', 'active')
    .eq('type', 'price')
    .in('ticker', tickers)

  if (error) {
    console.error('[Worker] evaluatePriceAlerts: fetch failed', error)
    return
  }

  for (const alert of alerts ?? []) {
    const currentPrice = prices[alert.ticker]
    if (currentPrice === undefined) continue

    const fired =
      (alert.operator === 'crosses_above' && currentPrice >= alert.value) ||
      (alert.operator === 'crosses_below' && currentPrice <= alert.value)

    if (!fired) continue

    const { error: updateError } = await supabase
      .from('price_alerts')
      .update({ status: 'triggered', triggered_at: new Date().toISOString() })
      .eq('id', alert.id)

    if (updateError) {
      console.error(`[Worker] evaluatePriceAlerts: update failed for ${alert.id}`, updateError)
      continue
    }

    const direction = alert.operator === 'crosses_above' ? '↑' : '↓'
    const msg = `🔔 Alerta disparada: ${alert.ticker} ${direction} ${alert.value}\nPrecio actual: ${currentPrice}`
    await sendTelegram(msg)
  }
}

async function getUserTickers(userId: string): Promise<{ stock: string[]; on: string[] }> {
  const supabase = getSupabase()
  if (!supabase) return { stock: [], on: [] }

  const [stockRes, onRes] = await Promise.all([
    supabase.from('positions').select('ticker').eq('user_id', userId),
    supabase.from('on_positions').select('ticker').eq('user_id', userId),
  ])

  const stock: string[] = Array.from(new Set((stockRes.data || []).map((p: any) => p.ticker as string)))
  const on: string[] = Array.from(new Set((onRes.data || []).map((p: any) => p.ticker as string)))
  return { stock, on }
}

// ── Worker ──────────────────────────────────────────────
const worker = new Worker(
  PRICE_QUEUE_NAME,
  async (job) => {
    if (job.name === 'refresh-summary') {
      const { userId } = job.data as { userId: string }
      console.log(`[Worker] Refreshing summary for ${userId}`)

      const { stock, on } = await getUserTickers(userId)
      const allPrices = await fetchQuotes([...stock, ...on])
      const { stockQuotes, onQuotes } = splitQuotesByAssetClass(allPrices, on)

      await cacheUserSummaries(stockQuotes, onQuotes)
      return
    }

    if (job.name === SNAPSHOT_JOB_NAME) {
      // Value the day on whatever prices we have — LKP from Redis is enough,
      // and snapshotAllUsers falls back to cost for anything still missing.
      const [stock, on] = await Promise.all([getAllTickers(), getAllONTickers()])
      const allPrices = await fetchQuotes([...stock, ...on])
      const { stockQuotes, onQuotes } = splitQuotesByAssetClass(allPrices, on)

      // Argentine calendar day, not UTC: the job runs at 02:00 UTC precisely so
      // it closes the local day, and by then the UTC date is already tomorrow.
      await snapshotAllUsers(stockQuotes, onQuotes, argentinaDate())
      return
    }

    if (job.name === TICKER_AUDIT_JOB_NAME) {
      const findings = await auditTickerIdentities(createServiceClient())
      if (findings.length === 0) {
        console.log('[Worker] Ticker audit: every held ticker matches its confirmed identity')
      } else {
        for (const f of findings) {
          if (f.kind === 'UNCATALOGUED') {
            console.warn(`[Worker] Ticker audit: ${f.ticker} is held but was never confirmed`)
          } else {
            console.warn(
              `[Worker] Ticker audit: ${f.ticker} was confirmed as "${f.confirmed}" but Yahoo now reports "${f.current}"`
            )
          }
        }
      }
      return
    }

    let tickers: string[] = []
    let onTickers: string[] = []

    if (job.name === PRICE_REPEAT_JOB_NAME) {
      if (!isMarketOpen()) {
        console.log('[Worker] Market is closed — skipping periodic fetch cycle')
        return
      }
      
      const [allTickers, allONTickers] = await Promise.all([getAllTickers(), getAllONTickers()])
      tickers = allTickers
      onTickers = allONTickers
      
      if (!tickers.length && !onTickers.length) {
        console.log('[Worker] No positions found — skipping')
        return
      }
    } else {
      // On-demand job: specific tickers. Which of them are ONs is decided by the
      // `ons` catalog, not by the D suffix — otherwise a CEDEAR like JD gets
      // requested from Data912, which only serves ONs.
      const requested = (job.data as { tickers: string[] }).tickers || []
      const onCatalog = new Set(
        (await getAllONTickers()).map(t => t.toUpperCase().trim())
      )
      onTickers = requested.filter(t => onCatalog.has(t.toUpperCase().trim()))
      tickers = requested.filter(t => !onCatalog.has(t.toUpperCase().trim()))
    }

    console.log(`[Worker] Fetching ${tickers.length} stocks and ${onTickers.length} ONs`)

    // 1. LOAD ALL EXISTING CACHED QUOTES (LKP)
    // This ensures we have a baseline for both stocks and ONs
    const allPrices = await fetchQuotes([...tickers, ...onTickers])
    console.log(`[Worker] Loaded ${allPrices.size} quotes from Redis cache (LKP)`)

    // 2. FETCH FRESH STOCK QUOTES (Yahoo)
    let freshYahooPrices = new Map<string, any>()
    if (tickers.length > 0) {
      try {
        freshYahooPrices = await fetchQuotesFromYahoo(tickers)
        console.log(`[Worker] Yahoo returned ${freshYahooPrices.size}/${tickers.length} prices`)
        
        // Cache fresh Yahoo prices to Redis
        freshYahooPrices.forEach((quote, ticker) => {
          cachePrice(ticker, quote).catch(e => console.error(`[Worker] Cache error for ${ticker}:`, e))
          allPrices.set(ticker, quote) // Overwrite LKP with fresh data
        })
      } catch (err) {
        console.error('[Worker] Yahoo fetch failed:', err)
      }
    }

    // 3. FETCH FRESH ON QUOTES (Data912)
    let freshONPrices = new Map<string, any>()
    if (onTickers.length > 0) {
      try {
        freshONPrices = await fetchData912Prices(onTickers)
        console.log(`[Worker] Data912 returned ${freshONPrices.size}/${onTickers.length} prices`)
        
        // Cache fresh ON prices to Redis AND Database
        freshONPrices.forEach((quote, ticker) => {
          cachePrice(ticker, quote).catch(e => console.error(`[Worker] Cache error for ${ticker}:`, e))
          allPrices.set(ticker, quote) // Overwrite LKP with fresh data
        })
        
        // Background DB update
        updateONPricesInDatabase(freshONPrices).catch(e => console.error('[Worker] DB update failed:', e))
        
      } catch (err) {
        console.error('[Worker] Data912 fetch failed:', err)
      }
    }

    const missing = [...tickers, ...onTickers].filter(t => !allPrices.has(t))
    if (missing.length > 0) {
      console.warn(`[Worker] No price (fresh or LKP) available for: ${missing.join(', ')}`)
    }

    console.log(`[Worker] Done — ${freshYahooPrices.size + freshONPrices.size} fresh, ${allPrices.size - (freshYahooPrices.size + freshONPrices.size)} from LKP, ${missing.length} missing`)

    // 4. EVALUATE PRICE ALERTS
    const pricesRecord: Record<string, number> = {}
    allPrices.forEach((quote, ticker) => {
      if (quote?.price !== undefined) {
        pricesRecord[ticker] = quote.price
      }
    })
    await evaluatePriceAlerts(pricesRecord).catch(e =>
      console.error('[Worker] evaluatePriceAlerts failed:', e)
    )

    // 6. UPDATE GLOBAL TIMESTAMP
    const redis = getRedis()
    if (redis) {
      await redis.set('system:last-refresh', new Date().toISOString())
    }

    // 7. CACHE USER SUMMARIES
    // Split allPrices back into stock and ON maps for the summary calculator
    const { stockQuotes, onQuotes } = splitQuotesByAssetClass(allPrices, onTickers)

    await cacheUserSummaries(stockQuotes, onQuotes)
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
  startSignalsWorker()
  checkNotificationConfig()
  console.log(`[Worker] Redis: ${REDIS_URL}`)

  // Redis must be reachable before scheduling — BullMQ's queue.add() hangs
  // on the offline queue when Redis is down (maxRetriesPerRequest: null).
  // Fail fast so Docker's restart policy retries instead of hanging silently.
  const outcome = resolveStartupOutcome(await ensureRedisAndScheduleJobs())
  if (outcome.exit) {
    console.error(outcome.message)
    process.exit(outcome.code)
  }

  // Immediate fetch on startup
  const [tickers, onTickers] = await Promise.all([getAllTickers(), getAllONTickers()])

  try {
    // 0. Load LKP (Last Known Price) from Redis first — ensures we have a baseline
    //    even if external APIs are down (same pattern as recurring job)
    const allPrices = new Map<string, any>()
    const lkpPrices = await fetchQuotes([...tickers, ...onTickers])
    lkpPrices.forEach((quote, ticker) => allPrices.set(ticker, quote))
    console.log(`[Worker] Loaded ${lkpPrices.size} quotes from Redis cache (LKP)`)

    // 1. Fetch stock prices from Yahoo — overwrite LKP with fresh data
    if (tickers.length) {
      console.log(`[Worker] Initial stock fetch for ${tickers.length} tickers...`)
      try {
        const prices = await fetchQuotesFromYahoo(tickers)
        const entries = Array.from(prices.entries())
        for (let i = 0; i < entries.length; i++) {
          const [ticker, quote] = entries[i]
          await cachePrice(ticker, quote)
          allPrices.set(ticker, quote)
        }
        console.log(`[Worker] Stock prices cached: ${prices.size}`)
      } catch (err) {
        console.error('[Worker] Yahoo fetch failed on startup:', err)
      }
    }

    // 2. Fetch ON prices from Data912 — overwrite LKP with fresh data
    if (onTickers.length) {
      console.log(`[Worker] Initial ON fetch for ${onTickers.length} tickers via Data912...`)
      try {
        const onPrices = await fetchData912Prices(onTickers)
        console.log(`[Worker] Data912 ON prices fetched: ${onPrices.size}`)
        onPrices.forEach((quote, ticker) => {
          cachePrice(ticker, quote).catch(e => console.error(`[Worker] Cache error for ${ticker}:`, e))
          allPrices.set(ticker, quote)
        })
        await updateONPricesInDatabase(onPrices)
      } catch (err) {
        console.error('[Worker] Data912 fetch failed on startup:', err)
      }
    }

    // Log tickers that have no price at all (neither LKP nor fresh)
    const missing = [...tickers, ...onTickers].filter(t => !allPrices.has(t))
    if (missing.length > 0) {
      console.warn(`[Worker] No price (fresh or LKP) available for: ${missing.join(', ')}`)
    }

    const redis = getRedis()
    if (redis) await redis.set('system:last-refresh', new Date().toISOString())

    // Split combined prices for cacheUserSummaries (mirrors recurring job pattern)
    const { stockQuotes, onQuotes } = splitQuotesByAssetClass(allPrices, onTickers)

    await cacheUserSummaries(stockQuotes, onQuotes)
  } catch (err) {
    console.error('[Worker] Initial fetch failed — will retry on next cycle:', err)
  }
}

main().catch(console.error)
