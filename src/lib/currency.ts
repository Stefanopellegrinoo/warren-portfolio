import { fetchRawQuotes } from './yahoo-finance'
import { fetchDailyBars } from './historical-prices'
import { getRedis, isRedisReady } from './redis'

const REDIS_KEY_CCL = 'currency:ccl'
const REDIS_KEY_CCL_LKP = 'currency:ccl:lkp'  // last-known rate, refreshed on each fresh fetch
const CACHE_TTL = 3600 // 1 hour
const LKP_TTL = 30 * 24 * 3600 // 30 days: Redis is noeviction, every key must expire

/**
 * Implicit Dolar CCL (GGAL ADR vs GGAL.BA, 1 ADR = 10 local shares).
 * Returns null when no real rate exists (Yahoo down, Redis empty): callers MUST NOT
 * price ARS quotes with an invented number, they skip them instead.
 */
export async function getCCLRate(): Promise<number | null> {
  return (await getCCLRateInfo())?.rate ?? null
}

export interface CclRateInfo {
  rate: number
  /** ISO instant the rate was observed: live = now, cache/lkp = now minus the Redis key's age. */
  asOf: string
  source: 'live' | 'cache' | 'lkp'
}

async function redisAgeMs(key: string, ttlSeconds: number): Promise<number> {
  let left = NaN
  try { left = Number(await getRedis()?.ttl(key)) } catch { /* age unknown: report 0, never fail a cache hit */ }
  return Number.isFinite(left) && left >= 0 ? Math.max(0, ttlSeconds - left) * 1000 : 0
}

/**
 * Lookup order: 1h cache, live Yahoo, 30-day last-known. Says how old the rate is and where it
 * came from, so a caller that prices bonds can refuse a long-lived last-known rate.
 * Returns null when nothing real exists; there is no hardcoded fallback.
 */
export async function getCCLRateInfo(): Promise<CclRateInfo | null> {
  const at = (ageMs: number) => new Date(Date.now() - ageMs).toISOString()
  if (isRedisReady()) {
    const cached = await getRedis()?.get(REDIS_KEY_CCL)
    if (cached) return { rate: parseFloat(cached), asOf: at(await redisAgeMs(REDIS_KEY_CCL, CACHE_TTL)), source: 'cache' }
  }
  try {
    const quotes = await fetchRawQuotes(['GGAL', 'BCBA:GGAL'])
    const adr = quotes.get('GGAL')
    const local = quotes.get('BCBA:GGAL')
    if (adr && local) {
      const ccl = (local.price * 10) / adr.price
      if (isRedisReady()) {
        const redis = getRedis()
        await redis?.setex(REDIS_KEY_CCL, CACHE_TTL, ccl.toString())
        await redis?.setex(REDIS_KEY_CCL_LKP, LKP_TTL, ccl.toString())
      }
      return { rate: ccl, asOf: at(0), source: 'live' }
    }
  } catch (err) {
    console.error('[Currency] Error calculating CCL rate:', err)
  }
  if (isRedisReady()) {
    const lkp = await getRedis()?.get(REDIS_KEY_CCL_LKP)
    if (lkp) return { rate: parseFloat(lkp), asOf: at(await redisAgeMs(REDIS_KEY_CCL_LKP, LKP_TTL)), source: 'lkp' }
  }
  console.error('[Currency] No CCL rate available (live fetch failed, no LKP in Redis)')
  return null
}

/**
 * Fetches historical CCL rates for a given period.
 * Returns a Map<DateString, CCLRate>
 */
export async function getHistoricalCCL(startDate: Date, endDate: Date = new Date()): Promise<Map<string, number>> {
  // endDate in the key too: start-only froze the map for 24h, so later closes were divided by a stale CCL.
  const cacheKey = `currency:h-ccl:${startDate.toISOString().split('T')[0]}:${endDate.toISOString().split('T')[0]}`
  
  if (isRedisReady()) {
    const cached = await getRedis()?.get(cacheKey)
    if (cached) {
      const parsed = JSON.parse(cached)
      return new Map(Object.entries(parsed))
    }
  }

  const rates = new Map<string, number>()
  try {
    // Raw bars, not fetchHistoricalQuotes: that one converts 'BCBA:' tickers by
    // calling getHistoricalCCL, which recursed forever from here.
    const [adr, local] = await Promise.all([
      fetchDailyBars('GGAL', startDate, endDate),
      fetchDailyBars('GGAL.BA', startDate, endDate)
    ])

    // Build adr map
    const adrMap = new Map<string, number>()
    adr.forEach(q => adrMap.set(q.date, q.close))

    local.forEach(q => {
      const adrClose = adrMap.get(q.date)
      if (adrClose) {
        rates.set(q.date, (q.close * 10) / adrClose)
      }
    })

    if (isRedisReady() && rates.size > 0) {
      await getRedis()?.setex(cacheKey, 86400, JSON.stringify(Object.fromEntries(rates)))
    }
  } catch (err) {
    console.error('[Currency] Error fetching historical CCL:', err)
  }

  return rates
}
