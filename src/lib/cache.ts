/**
 * Strategic Cache Layer with Redis
 * 
 * Provides reusable caching utilities for performance-critical operations.
 * Gracefully degrades to direct fetching if Redis is unavailable.
 * 
 * Usage:
 *   const balance = await cached('cash:balance:userId', 30, () => getCashBalance(userId))
 */

import { getRedis, isRedisReady, KEY_PREFIX, stripKeyPrefix } from './redis'

/**
 * Generic cache wrapper with TTL and fallback.
 * 
 * @param key - Unique cache key (will be prefixed with 'warren:' automatically)
 * @param ttlSeconds - Time to live in seconds
 * @param fetcher - Async function to fetch data if cache miss
 * @returns Cached data or fresh data from fetcher
 * 
 * @example
 * ```typescript
 * const balance = await cached(
 *   `cash:balance:${userId}`,
 *   30, // 30 seconds
 *   () => getCashBalance(userId)
 * )
 * ```
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  // If Redis is not available, bypass cache
  if (!isRedisReady()) {
    return fetcher()
  }

  const redis = getRedis()
  if (!redis) {
    return fetcher()
  }

  try {
    // Try to get from cache
    const cached = await redis.get(key)
    if (cached) {
      return JSON.parse(cached) as T
    }

    // Cache miss — fetch fresh data
    const result = await fetcher()

    // Store in cache (fire and forget — don't block on write)
    redis.setex(key, ttlSeconds, JSON.stringify(result)).catch((err) => {
      console.warn(`[Cache] Failed to write key ${key}:`, err.message)
    })

    return result
  } catch (err) {
    console.warn(`[Cache] Error reading key ${key}:`, err)
    // Fall back to direct fetch
    return fetcher()
  }
}

/**
 * Invalidate cache entries matching a pattern.
 * 
 * @param pattern - Redis key pattern (e.g., 'cash:*', 'portfolio:userId:*')
 * 
 * @example
 * ```typescript
 * // After inserting a cash movement, invalidate all cash caches for this user
 * await invalidateCache(`cash:*:${userId}`)
 * ```
 */
export async function invalidateCache(pattern: string): Promise<void> {
  if (!isRedisReady()) return

  const redis = getRedis()
  if (!redis) return

  try {
    let cursor = '0'
    const keysToDelete: string[] = []

    // Scan for matching keys (handles large keyspaces efficiently).
    // ioredis does NOT prefix SCAN's MATCH: the pattern must carry the
    // warren: prefix itself, and the returned full keys must be stripped
    // before DEL re-adds it.
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        'MATCH',
        `${KEY_PREFIX}${pattern}`,
        'COUNT',
        100
      )
      cursor = nextCursor
      keysToDelete.push(...keys.map(stripKeyPrefix))
    } while (cursor !== '0')

    if (keysToDelete.length > 0) {
      await redis.del(...keysToDelete)
      console.log(`[Cache] Invalidated ${keysToDelete.length} keys matching: ${pattern}`)
    }
  } catch (err) {
    console.warn(`[Cache] Failed to invalidate pattern ${pattern}:`, err)
  }
}

/**
 * Invalidate a single cache key.
 * 
 * @param key - Exact cache key to delete
 */
export async function invalidateCacheKey(key: string): Promise<void> {
  if (!isRedisReady()) return

  const redis = getRedis()
  if (!redis) return

  try {
    await redis.del(key)
    console.log(`[Cache] Invalidated key: ${key}`)
  } catch (err) {
    console.warn(`[Cache] Failed to invalidate key ${key}:`, err)
  }
}

/**
 * Cache TTL constants for common use cases.
 * Adjust based on data volatility and user expectations.
 */
export const CacheTTL = {
  /** Cash balance — changes on deposits/withdrawals */
  CASH_BALANCE: 30, // 30 seconds
  
  /** Portfolio summary — changes on any transaction */
  PORTFOLIO_SUMMARY: 60, // 1 minute
  
  /** Ticker prices from external API */
  TICKER_PRICES: 300, // 5 minutes
  
  /** ON positions — changes on buys/sells */
  ON_POSITIONS: 30, // 30 seconds
  
  /** Stock positions — changes on transactions */
  STOCK_POSITIONS: 30, // 30 seconds
  
  /** Historical data (immutable) */
  HISTORICAL_DATA: 3600, // 1 hour
} as const
