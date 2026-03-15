import Redis from 'ioredis'

let redisClient: Redis | null = null
let redisReady = false

function getRedisUrl(): string {
  return process.env.REDIS_URL || 'redis://localhost:6379'
}

/**
 * Get the Redis client. Creates it lazily on first call.
 * Returns null if Redis is not configured or connection fails.
 */
export function getRedis(): Redis | null {
  if (redisClient) return redisClient

  try {
    redisClient = new Redis(getRedisUrl(), {
      maxRetriesPerRequest: null, // Required for BullMQ
      lazyConnect: true,
      retryStrategy(times) {
        if (times > 3) return null // Stop retrying after 3 attempts
        return Math.min(times * 200, 2000)
      },
    })

    redisClient.on('connect', () => {
      redisReady = true
      console.log('[Redis] Connected')
    })

    redisClient.on('error', (err) => {
      redisReady = false
      console.warn('[Redis] Connection error:', err.message)
    })

    redisClient.on('close', () => {
      redisReady = false
    })

    // Attempt to connect (non-blocking)
    redisClient.connect().catch(() => {
      console.warn('[Redis] Could not connect — running without cache')
    })

    return redisClient
  } catch {
    console.warn('[Redis] Failed to create client — running without cache')
    return null
  }
}

/**
 * Check if Redis is currently connected and ready.
 */
export function isRedisReady(): boolean {
  return redisReady && redisClient !== null
}

/**
 * Get Redis connection options (for BullMQ).
 * Returns the URL string for BullMQ Queue/Worker connection.
 */
export function getRedisConnectionOpts() {
  return { connection: { url: getRedisUrl() } }
}

// ── Caching Helpers ─────────────────────────────────────

/**
 * Caches a JSON serializable object in Redis.
 */
export async function cacheRoute(key: string, data: any, ttlSeconds: number = 300): Promise<void> {
  if (!isRedisReady()) return
  try {
    const redis = getRedis()
    if (redis) {
      await redis.setex(key, ttlSeconds, JSON.stringify(data))
    }
  } catch (err) {
    console.warn(`[Redis] Failed to cache route ${key}`, err)
  }
}

/**
 * Retrieves a JSON object from Redis cache.
 */
export async function getCachedRoute<T>(key: string): Promise<T | null> {
  if (!isRedisReady()) return null
  try {
    const redis = getRedis()
    if (redis) {
      const cached = await redis.get(key)
      if (cached) return JSON.parse(cached) as T
    }
  } catch (err) {
    console.warn(`[Redis] Failed to retrieve cache for ${key}`, err)
  }
  return null
}

/**
 * Invalidates all user-specific route caches when data mutates.
 * Clears pattern: history:{userId}:* and statistics:{userId}
 */
export async function invalidateUserCache(userId: string): Promise<void> {
  if (!isRedisReady()) return
  try {
    const redis = getRedis()
    if (!redis) return

    // Find keys matching history:{userId}:*
    let cursor = '0'
    const keysToDelete: string[] = []
    
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `history:${userId}:*`, 'COUNT', 100)
      cursor = nextCursor
      keysToDelete.push(...keys)
    } while (cursor !== '0')

    // Add exactly matching keys
    keysToDelete.push(`statistics:${userId}`)

    if (keysToDelete.length > 0) {
      await redis.del(...keysToDelete)
      console.log(`[Redis] Invalidated ${keysToDelete.length} cache keys for user ${userId}`)
    }
  } catch (err) {
    console.warn(`[Redis] Failed to invalidate cache for user ${userId}`, err)
  }
}

export default { getRedis, isRedisReady, getRedisConnectionOpts, cacheRoute, getCachedRoute, invalidateUserCache }
