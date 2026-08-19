import { valuePortfolio } from './portfolio-valuation'
import { loadUserPortfolios } from './user-portfolios'
import { getRedis, SUMMARY_CACHE_TTL } from './redis'

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
    console.log(`[Worker] Discarded stale summary write for ${userId} (version changed)`)
    return false
  }

  return true
}

/**
 * For every user with active positions or cash, calculates and caches their
 * summary in Redis. This makes the Dashboard sub-10ms.
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

  const portfolios = await loadUserPortfolios()

  const redis = getRedis()
  if (!redis) return

  for (const portfolio of portfolios) {
    const { userId } = portfolio
    const isImporting = await redis.get(`importing:${userId}`)
    if (isImporting) {
      console.log(`[Worker] Skipping summary cache for ${userId} — import in progress`)
      continue
    }

    // Read version at the start of the per-user computation
    const startVersion = await redis.get(`summary:version:${userId}`)

    const { positions: enriched, onPositions: enrichedONs, summary } = valuePortfolio(
      {
        positions: portfolio.positions,
        onPositions: portfolio.onPositions,
        cashBalance: portfolio.cashBalance,
        realized: portfolio.realized,
        onRealized: portfolio.onRealized,
      },
      { stockQuotes, onQuotes },
      { missingQuotePolicy: 'drop' }
    )

    const payload = JSON.stringify({ positions: enriched, onPositions: enrichedONs, summary })
    await setSummaryIfVersion(userId, payload, startVersion)
  }

  console.log(`[Worker] Cached summaries for ${portfolios.length} users (stocks + ONs + cash).`)
}
