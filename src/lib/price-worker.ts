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
import { PRICE_QUEUE_NAME, PRICE_REPEAT_JOB_NAME, NIGHTLY_JOB_NAME, TICKER_AUDIT_JOB_NAME, ON_TERMS_JOB_NAME, FX_RATES_JOB_NAME } from './queue'
import { fetchQuotesFromYahoo, cachePrice, fetchQuotes } from './yahoo-finance'
import { fetchData912Prices, refreshLocalPrices } from './data912-client'
import { createServiceClient } from './supabase-server'
import { priceAlertPush, pushKeys, sendPushToUser } from './push'
import { getRedis } from './redis'
import { cacheUserSummaries } from './summary-cache'
import { captureOnPriceHistory } from './on-price-history'
import { splitQuotesByAssetClass } from './portfolio-valuation'
import { isMarketOpen, argentinaDate } from './utils'
import { startImportWorker } from './import-worker'
import { startSignalsWorker } from './signals-worker'
import { checkNotificationConfig, escapeHtml, sendTelegram } from './notifications'
import { alertJobFailure, beat, recordRefresh } from './job-health'
import { ensureRedisAndScheduleJobs, resolveStartupOutcome } from './worker-startup'
import { auditTickerIdentities } from './ticker-audit'
import { ingestOnTerms } from './on-terms-ingest'
import { ingestFxRates } from './fx-rates'
import { loadHeldStockTickers, loadPortfolioNow } from './ledger-now'
import { fetchCryptoQuotes } from './binance/rest'
import { getProviderForSymbol } from './market-data/resolver'
import { isPriceValue } from './chart/alert-condition'
import { claimAlert, crossingOf, evaluateConditionAlerts, firesOn, type ConditionAlertRow } from './alert-evaluator'

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

  try {
    return await loadHeldStockTickers(supabase)
  } catch (error) {
    console.error('[Worker] Error reading held tickers from the ledger:', error)
    return []
  }
}

/**
 * Fetch the distinct tickers that have an active price alert, held or not
 */
async function getActiveAlertTickers(): Promise<string[]> {
  const supabase = getSupabase()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('price_alerts')
    .select('ticker')
    .eq('status', 'active')
    .eq('type', 'price')

  if (error) {
    console.error('[Worker] Error fetching alert tickers:', error)
    return []
  }

  return Array.from(new Set((data || []).map((a: any) => a.ticker) as string[]))
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
 * Evaluate the active alerts of these tickers.
 * The price against a value fires only on a real cross: the previous price (the
 * LKP before this update) on one side of the line and the current price on or
 * past it. A ticker with no previous price never fires.
 * Every other condition (an indicator line, a line target) is checked on its
 * candles by alert-evaluator.ts, for every ticker of the cycle, priced or not.
 * Uses createServiceClient (RLS bypass) since this runs in the worker.
 * On trigger: marks the alert as 'triggered' (only while it is active: the row is
 * the guard against a second cycle or worker), pushes it to the owner's devices
 * and sends a Telegram message.
 */
export async function evaluatePriceAlerts(
  prices: Record<string, number>,
  previousPrices: Record<string, number>,
  tickers: string[] = Object.keys(prices)
): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return

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

  const conditions: ConditionAlertRow[] = []
  for (const alert of alerts ?? []) {
    // The price against a value, on this cycle's quotes; an indicator line or a line target never fires on
    // the price crossing a number: it goes to its candles (odd/tasks/chart-customization.md S7).
    if (!isPriceValue({ source: alert.source ?? 'price', target: alert.target ?? 'value' })) {
      conditions.push(alert)
      continue
    }
    const currentPrice = prices[alert.ticker]
    const previousPrice = previousPrices[alert.ticker]
    if (currentPrice === undefined || previousPrice === undefined) continue

    const value = Number(alert.value)
    const way = crossingOf(previousPrice - value, currentPrice - value)
    if (!way || !firesOn(alert.operator, way)) continue

    if (!(await claimAlert(supabase, alert.id, { status: 'triggered', triggered_at: new Date().toISOString() }))) continue

    // Either way says which way it went. A user who never turned notifications on has no devices: that is not a failure.
    const crossed = way === 'up' ? 'crosses_above' : 'crosses_below'
    const push = await sendPushToUser(supabase, alert.user_id, priceAlertPush({ ...alert, operator: crossed }, value, currentPrice))
    if (!push.ok && push.error !== 'no devices') console.warn(`[Worker] push for alert ${alert.id}: ${push.error}`)

    const direction = way === 'up' ? '↑' : '↓'
    const msg = `🔔 Alerta disparada: ${alert.ticker} ${direction} ${alert.value}\nPrecio actual: ${currentPrice}`
    await sendTelegram(msg)
  }

  await evaluateConditionAlerts(supabase, conditions)
}

/**
 * Peso-line prices for the Pesos / MEP / Cable views. A data912 failure must
 * never fail the price cycle: it is logged and the last-known prices stay.
 */
async function refreshPesoPrices(tickers: string[]): Promise<void> {
  try {
    const n = await refreshLocalPrices(tickers)
    console.log(`[Worker] data912 peso prices: ${n} cached`)
  } catch (err) {
    console.error('[Worker] data912 peso prices failed, last-known prices kept:', err)
  }
}

const isCrypto = (ticker: string) => getProviderForSymbol(ticker) === 'binance'

/**
 * Crypto trades around the clock, so its alerts are checked on every cycle, market
 * hours or not, with Binance prices (the ones the chart shows). A failure is logged
 * and never stops the stock cycle.
 */
async function checkCryptoAlerts(tickers: string[]): Promise<void> {
  if (!tickers.length) return
  try {
    const previousPrices = toPriceRecord(await fetchQuotes(tickers))
    const fresh = await fetchCryptoQuotes(tickers)
    fresh.forEach((quote, ticker) => {
      cachePrice(ticker, quote).catch(e => console.error(`[Worker] Cache error for ${ticker}:`, e))
    })
    console.log(`[Worker] Crypto alerts: ${fresh.size}/${tickers.length} prices from Binance`)
    await evaluatePriceAlerts(toPriceRecord(fresh), previousPrices, tickers)
  } catch (err) {
    console.error('[Worker] Crypto alerts failed:', err)
  }
}

function toPriceRecord(quotes: Map<string, any>): Record<string, number> {
  const record: Record<string, number> = {}
  quotes.forEach((quote, ticker) => {
    if (quote?.price !== undefined) record[ticker] = quote.price
  })
  return record
}

async function getUserTickers(userId: string): Promise<{ stock: string[]; on: string[] }> {
  const supabase = getSupabase()
  if (!supabase) return { stock: [], on: [] }

  // The ledger core, not the stored positions (odd/tasks/nucleo-ledger.md T4.2b).
  const now = await loadPortfolioNow(supabase, userId, argentinaDate())
  const stock = now.stockPositions.map(p => p.ticker)
  const on = now.onPositions.map(p => p.ticker)
  return { stock, on }
}

/**
 * Nightly job: capture the day's ON closes into on_price_history (market data
 * the derived history values ONs with). It uses the Argentine calendar day, not
 * UTC: the job runs at 02:00 UTC precisely so it closes the local day, and by
 * then the UTC date is already tomorrow. A failure is reported, never thrown.
 */
export async function runNightlyJob(): Promise<void> {
  const date = argentinaDate()

  try {
    const supabase = getSupabase()
    if (!supabase) throw new Error('Supabase not configured')
    const written = await captureOnPriceHistory(supabase, date)
    console.log(`[Worker] on_price_history: ${written} rows for ${date}`)
  } catch (err) {
    console.error('[Worker] on_price_history capture failed:', err)
    // sendTelegram uses parse_mode HTML: an unescaped '<' (e.g. an HTML error page
    // in a JSON parse error) makes Telegram reject the alert. It reports that as
    // {ok:false}, not a throw, so check the result too.
    const reason = escapeHtml((err instanceof Error ? err.message : String(err)).slice(0, 500))
    await sendTelegram(`on_price_history capture failed for ${date}: ${reason}`)
      .then(r => { if (!r?.ok) console.error('[Worker] Telegram alert not delivered:', r?.error) })
      .catch(e => console.error('[Worker] Telegram alert failed:', e))
  }
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

    if (job.name === NIGHTLY_JOB_NAME) {
      await runNightlyJob()
      return
    }

    if (job.name === ON_TERMS_JOB_NAME) {
      // Failures propagate: the worker 'failed' handler alerts (alertJobFailure) and
      // the DB keeps last-good because the RPC never ran.
      const s = await ingestOnTerms(createServiceClient())
      console.log(`[Worker] ON terms ${s.asOf}: ${s.ons} ONs, ${s.skipped} skipped, ${s.checks} checks (${s.flagged} flagged), ${s.sov} sov`)
      return
    }

    if (job.name === FX_RATES_JOB_NAME) {
      // Failures propagate to the 'failed' handler; the table keeps last-good rows.
      const n = await ingestFxRates(createServiceClient())
      console.log(`[Worker] FX rates: ${n.mep} MEP days, ${n.ccl} CCL days`)
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
      const alertTickers = await getActiveAlertTickers()
      await checkCryptoAlerts(alertTickers.filter(isCrypto))

      if (!isMarketOpen()) {
        console.log('[Worker] Market is closed — skipping periodic fetch cycle')
        return
      }
      
      const [allTickers, allONTickers] = await Promise.all([getAllTickers(), getAllONTickers()])
      onTickers = allONTickers
      // Alert tickers need a price even when nobody holds them. ONs among them
      // are already fetched from Data912 via the catalog, and crypto from Binance
      // above, so they stay off Yahoo.
      const onCatalog = new Set(allONTickers.map(t => t.toUpperCase().trim()))
      tickers = Array.from(new Set([
        ...allTickers,
        ...alertTickers.filter(t => !onCatalog.has(t.toUpperCase().trim()) && !isCrypto(t)),
      ]))
      
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
    // The LKP before this update is the "previous" side of an alert cross
    const previousPrices = toPriceRecord(allPrices)

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

    // 3b. PESO-LINE PRICES (data912) — the periodic cycle only
    if (job.name === PRICE_REPEAT_JOB_NAME && tickers.length > 0) await refreshPesoPrices(tickers)

    const missing = [...tickers, ...onTickers].filter(t => !allPrices.has(t))
    if (missing.length > 0) {
      console.warn(`[Worker] No price (fresh or LKP) available for: ${missing.join(', ')}`)
    }

    console.log(`[Worker] Done — ${freshYahooPrices.size + freshONPrices.size} fresh, ${allPrices.size - (freshYahooPrices.size + freshONPrices.size)} from LKP, ${missing.length} missing`)

    // 4. EVALUATE PRICE ALERTS — every ticker of the cycle: a condition alert is checked on its candles even
    //    when its ticker got no price (an unknown ticker must say so, not wait forever)
    await evaluatePriceAlerts(toPriceRecord(allPrices), previousPrices, [...tickers, ...onTickers]).catch(e =>
      console.error('[Worker] evaluatePriceAlerts failed:', e)
    )

    // 6. UPDATE GLOBAL TIMESTAMP
    await recordRefresh()

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
  void beat()
})

worker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job?.name} (${job?.id}) failed: ${err.message}`)
  void alertJobFailure('price', job?.name ?? 'unknown', err)
})

// ── Start ───────────────────────────────────────────────
async function main() {
  console.log('[Worker] Price update worker started')
  startImportWorker()
  startSignalsWorker()
  checkNotificationConfig()
  console.log(pushKeys() ? '[notifications] Push enabled' : '[notifications] Push disabled — VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT missing')
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

    if (tickers.length) await refreshPesoPrices(tickers)

    // Log tickers that have no price at all (neither LKP nor fresh)
    const missing = [...tickers, ...onTickers].filter(t => !allPrices.has(t))
    if (missing.length > 0) {
      console.warn(`[Worker] No price (fresh or LKP) available for: ${missing.join(', ')}`)
    }

    await recordRefresh()

    // Split combined prices for cacheUserSummaries (mirrors recurring job pattern)
    const { stockQuotes, onQuotes } = splitQuotesByAssetClass(allPrices, onTickers)

    await cacheUserSummaries(stockQuotes, onQuotes)
  } catch (err) {
    console.error('[Worker] Initial fetch failed — will retry on next cycle:', err)
  }
}

main().catch(console.error)
