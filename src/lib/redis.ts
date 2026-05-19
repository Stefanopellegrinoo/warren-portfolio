import Redis from 'ioredis'

let redisClient: Redis | null = null
let redisReady = false
let connectPromise: Promise<void> | null = null

function getRedisUrl(): string {
  const redis_url = process.env.REDIS_URL || ''
  if (!redis_url) {
    console.error('[Redis] REDIS_URL is not defined')
  }
  return redis_url
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
      keyPrefix: 'warren:',
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

    // Store the connect promise so we can await it
    connectPromise = redisClient.connect().then(() => {
      redisReady = true
    }).catch(() => {
      console.warn('[Redis] Could not connect — running without cache')
    })

    return redisClient
  } catch {
    console.warn('[Redis] Failed to create client — running without cache')
    return null
  }
}

/**
 * Ensure Redis is connected before reading/writing.
 * Call this in API routes before accessing Redis.
 * Returns true if Redis is ready, false otherwise.
 */
export async function ensureRedisConnected(): Promise<boolean> {
  // Trigger creation if not yet created
  if (!redisClient) {
    getRedis()
  }
  
  // If already ready, return immediately
  if (redisReady) return true
  
  // Wait for the connection to be established
  if (connectPromise) {
    await connectPromise
  }
  
  return redisReady
}

/**
 * Check if Redis is currently connected and ready.
 * WARNING: This is synchronous — may return false if connection is still establishing.
 * For API routes, prefer ensureRedisConnected() instead.
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

// ioredis prepends keyPrefix to GET/SET/DEL but SCAN returns full Redis keys (with prefix).
// Passing those keys back to DEL would double-prefix them: warren:warren:key.
// Strip the prefix before using SCAN results in other commands.
const KEY_PREFIX = 'warren:'

function stripKeyPrefix(key: string): string {
  return key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : key
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
      // Strip the prefix — ioredis will re-add it when calling DEL
      keysToDelete.push(...keys.map(stripKeyPrefix))
    } while (cursor !== '0')

    // Find keys matching lots:def:{userId}:*
    let lotsCursor = '0'
    do {
      const [nextCursor, keys] = await redis.scan(lotsCursor, 'MATCH', `lots:def:${userId}:*`, 'COUNT', 100)
      lotsCursor = nextCursor
      keysToDelete.push(...keys.map(stripKeyPrefix))
    } while (lotsCursor !== '0')

    // Add exactly matching keys (no prefix stripping needed — DEL adds it)
    keysToDelete.push(`statistics:${userId}`)
    keysToDelete.push(`statistics:combined:${userId}`)
    keysToDelete.push(`statistics:ons:${userId}`)
    keysToDelete.push(`summary:${userId}`)

    if (keysToDelete.length > 0) {
      await redis.del(...keysToDelete)
      console.log(`[Redis] Invalidated ${keysToDelete.length} cache keys for user ${userId}`)
    }
  } catch (err) {
    console.warn(`[Redis] Failed to invalidate cache for user ${userId}`, err)
  }
}

export default { getRedis, isRedisReady, ensureRedisConnected, getRedisConnectionOpts, cacheRoute, getCachedRoute, invalidateUserCache }
