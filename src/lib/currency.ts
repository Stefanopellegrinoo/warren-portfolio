import { fetchRawQuotes } from './yahoo-finance'
import { getRedis, isRedisReady } from './redis'

const REDIS_KEY_CCL = 'currency:ccl'
const REDIS_KEY_CCL_LKP = 'currency:ccl:lkp'  // persists indefinitely, updated on each fresh fetch
const CACHE_TTL = 3600 // 1 hour

/**
 * Fetches the implicit Dolar CCL (Contado con Liquidacion) rate
 * by comparing GGAL (NASDAQ) vs GGAL.BA (Buenos Aires).
 * GGAL 1 ADR = 10 local shares.
 */
export async function getCCLRate(): Promise<number> {
  // 1. Try short-lived cache (1h TTL)
  if (isRedisReady()) {
    const cached = await getRedis()?.get(REDIS_KEY_CCL)
    if (cached) return parseFloat(cached)
  }

  try {
    // 2. Fetch GGAL (USD) and GGAL.BA (ARS)
    // GGAL ratio is 1:10 (1 ADR = 10 local shares)
    const quotes = await fetchRawQuotes(['GGAL', 'BCBA:GGAL'])
    const adr = quotes.get('GGAL')
    const local = quotes.get('BCBA:GGAL')

    if (adr && local) {
      // CCL = (Local Price * Ratio) / ADR Price
      // Example: GGAL.BA = 5000, GGAL = 50, Ratio = 10 -> (5000*10)/50 = 1000
      const ccl = (local.price * 10) / adr.price

      if (isRedisReady()) {
        const redis = getRedis()
        // Short-lived cache (refreshed hourly)
        await redis?.setex(REDIS_KEY_CCL, CACHE_TTL, ccl.toString())
        // LKP — no expiry, always reflects the last successfully fetched rate
        await redis?.set(REDIS_KEY_CCL_LKP, ccl.toString())
      }
      return ccl
    }
  } catch (err) {
    console.error('[Currency] Error calculating CCL rate:', err)
  }

  // 3. Fallback to last known price (LKP) rather than a stale hardcoded constant
  if (isRedisReady()) {
    const lkp = await getRedis()?.get(REDIS_KEY_CCL_LKP)
    if (lkp) {
      console.warn('[Currency] Using LKP CCL rate — live fetch failed')
      return parseFloat(lkp)
    }
  }

  // Absolute last resort — log loudly so it's visible in production
  console.error('[Currency] No CCL rate available (live fetch failed, no LKP in Redis). Using emergency fallback.')
  return 1100
}

/**
 * Fetches historical CCL rates for a given period.
 * Returns a Map<DateString, CCLRate>
 */
export async function getHistoricalCCL(startDate: Date, endDate: Date = new Date()): Promise<Map<string, number>> {
  const cacheKey = `currency:h-ccl:${startDate.toISOString().split('T')[0]}`
  
  if (isRedisReady()) {
    const cached = await getRedis()?.get(cacheKey)
    if (cached) {
      const parsed = JSON.parse(cached)
      return new Map(Object.entries(parsed))
    }
  }

  const rates = new Map<string, number>()
  try {
    const { fetchHistoricalQuotes } = await import('./yahoo-finance')
    const [adr, local] = await Promise.all([
      fetchHistoricalQuotes('GGAL', startDate, endDate),
      fetchHistoricalQuotes('BCBA:GGAL', startDate, endDate)
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
