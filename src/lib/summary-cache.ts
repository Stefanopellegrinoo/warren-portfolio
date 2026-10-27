import { valuePortfolio } from './portfolio-valuation'
import { loadAllSchedules, portfoliosFrom } from './user-portfolios'
import { getRedis, SUMMARY_CACHE_TTL } from './redis'
import { createServiceClient } from './supabase-server'
import { currencyViewsFor, loadCurrencyContext, LEDGER_COLUMNS, tradeDateFx, type ViewsLedger } from './currency-views'
import type { CurrencyViews, LedgerTrade } from './multicurrency'
import { loadAllLedgers, loadLastCloses } from './ledger-now'
import { memoByLedgerVersion } from './ledger-memo'
import { argentinaDate } from './utils'

/**
 * What the per-minute cycle needs that only a write changes (odd/tasks/supabase-efficiency.md S2-S3):
 * every ledger, read once with the currency views' columns, the ON schedules, each user's portfolio
 * and the ledger and trade-date FX of their views. Prices change every minute; these are reused until
 * the ledger version moves (ledger-memo.ts). A failed ledger read throws, as loadUserPortfolios does.
 */
export const loadCycleInputs = memoByLedgerVersion(async () => {
  const today = argentinaDate()
  const ledgers = await loadAllLedgers(createServiceClient(), LEDGER_COLUMNS)
  const schedules = await loadAllSchedules(ledgers, today)
  const portfolios = portfoliosFrom(ledgers, schedules, today)
  const views = new Map<string, ViewsLedger>(await Promise.all(portfolios.map(async ({ userId }) => {
    const ledger = ledgers.get(userId)!
    const trades = ledger.trades as unknown as LedgerTrade[]
    // An unreadable FX is read again by the views themselves, which fail alone, never the summary.
    const fxRows = await tradeDateFx(trades).catch(() => undefined)
    return [userId, { trades, overrides: ledger.overrides, schedules, splits: ledger.splits, fxRows }] as const
  })))
  return { ledgers, portfolios, views }
})

/**
 * Lua compare-and-set used by cacheUserSummaries to avoid overwriting a summary
 * that was invalidated (version bumped) while the summary was being computed.
 *
 * KEYS[1]   summary:{userId}
 * KEYS[2]   summary:version:{userId}
 * ARGV[1]   startVersion (empty string means "no version key yet")
 * ARGV[2]   TTL in seconds
 * ARGV[3]   payload
 */
export const SUMMARY_SETEX_LUA = `
local key = KEYS[1]
local versionKey = KEYS[2]
local startVersion = ARGV[1]
local ttl = tonumber(ARGV[2])
local payload = ARGV[3]
local currentVersion = redis.call('GET', versionKey) or ''
if currentVersion == startVersion then
  redis.call('SETEX', key, ttl, payload)
  return 1
else
  return 0
end
`

/**
 * Atomically write a user summary only if the version counter still matches the
 * value observed at the start of the computation. Returns true when the write
 * succeeded, false when it was discarded because a mutation bumped the version.
 */
export async function setSummaryIfVersion(
  userId: string,
  payload: string,
  startVersion: string | null
): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return false

  const version = startVersion ?? ''
  const result = await redis.eval(
    SUMMARY_SETEX_LUA,
    2,
    `summary:${userId}`,
    `summary:version:${userId}`,
    version,
    SUMMARY_CACHE_TTL,
    payload
  )

  if (result === 0 || result === '0') {
    console.log(`[Summary] Discarded stale summary write for ${userId} (version changed)`)
    return false
  }

  return true
}

/** The cached summary `summary:{userId}`, one format for the worker and /api/positions. */
export function summaryPayload(
  valued: Pick<ReturnType<typeof valuePortfolio>, 'positions' | 'onPositions' | 'summary' | 'unpricedCount' | 'unpricedTickers'>,
  currencies?: CurrencyViews
): string {
  const { positions, onPositions, summary, unpricedCount, unpricedTickers } = valued
  return JSON.stringify({ positions, onPositions, summary, unpricedCount, unpricedTickers, ...(currencies && { currencies }) })
}

/**
 * For every user with active positions or cash (from the ledger core), calculates
 * and caches their summary in Redis. This makes the Dashboard sub-10ms.
 *
 * stockQuotes: prices from Yahoo Finance
 * onQuotes: prices from Data912 (may be empty if Data912 not configured)
 */
export async function cacheUserSummaries(
  stockQuotes: Map<string, any>,
  onQuotes: Map<string, any> = new Map()
) {
  if (stockQuotes.size === 0 && onQuotes.size === 0) {
    console.log('[Worker] No prices available — skipping summary cache')
    return
  }

  console.log('[Worker] Caching user summaries...')

  const { portfolios, views } = await loadCycleInputs()

  const redis = getRedis()
  if (!redis) return

  // The Pesos / MEP / Cable views are an addition: failing to build them never
  // blocks the summary, which then keeps only the USD fields.
  const supabase = createServiceClient()
  const currencyCtx = await loadCurrencyContext(supabase).catch(err => {
    console.error('[Worker] currency views unavailable this cycle:', err)
    return null
  })

  for (const portfolio of portfolios) {
    const { userId } = portfolio
    const isImporting = await redis.get(`importing:${userId}`)
    if (isImporting) {
      console.log(`[Worker] Skipping summary cache for ${userId} — import in progress`)
      continue
    }

    // Read version at the start of the per-user computation
    const startVersion = await redis.get(`summary:version:${userId}`)

    const valued = valuePortfolio(
      {
        positions: portfolio.positions,
        onPositions: portfolio.onPositions,
        cashBalance: portfolio.cashBalance,
        realized: portfolio.realized,
        onRealized: portfolio.onRealized,
      },
      { stockQuotes, onQuotes },
      await loadLastCloses(supabase, portfolio.onPositions, onQuotes)
    )

    const currencies = currencyCtx
      ? await currencyViewsFor(supabase, userId, currencyCtx, { positions: valued.positions, onPositions: valued.onPositions, cashBalance: portfolio.cashBalance }, views.get(userId))
          .catch(err => { console.error(`[Worker] currency views failed for ${userId}:`, err); return undefined })
      : undefined

    await setSummaryIfVersion(userId, summaryPayload(valued, currencies), startVersion)
  }

  console.log(`[Worker] Cached summaries for ${portfolios.length} users (stocks + ONs + cash).`)
}
