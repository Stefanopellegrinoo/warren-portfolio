import { NextResponse } from 'next/server'
import { getRedis, ensureRedisConnected } from '@/lib/redis'

/**
 * Fixed-window rate limit: allows `max` hits per `windowSec` for `key`.
 * Returns true when the request may proceed. The Redis client adds `warren:`.
 */
// Every authenticated route waits on this; a local Redis answers in a few ms.
const REDIS_TIMEOUT_MS = 250

export async function rateLimit(key: string, max: number, windowSec: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const check = (async () => {
    // With maxRetriesPerRequest: null a command on a dead connection waits forever,
    // so check the connection before sending anything.
    const redis = (await ensureRedisConnected()) ? getRedis() : null
    if (!redis) throw new Error('Redis not connected')
    // SET NX EX creates the counter with its TTL in the same MULTI as the INCR,
    // so a counter can never be left without an expiry.
    const [, [err, count]] = (await redis.multi().set(key, '0', 'EX', windowSec, 'NX').incr(key).exec())!
    if (err) throw err
    return Number(count) <= max
  })()
  check.catch(() => {}) // a late failure after the timeout must not be an unhandled rejection
  // A hung Redis (packets dropped, no reset) would otherwise hang every route: the client has no command timeout.
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no reply in ${REDIS_TIMEOUT_MS} ms`)), REDIS_TIMEOUT_MS)
  })
  try {
    return await Promise.race([check, timeout])
  } catch (err) {
    // ponytail: fail-open keeps the app up when Redis is down; fail closed if abuse becomes real.
    console.warn(`[rate-limit] ${key} not checked, allowing:`, err)
    return true
  } finally {
    clearTimeout(timer)
  }
}

export function tooManyRequests(windowSec: number): NextResponse {
  return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(windowSec) } })
}

/**
 * The caller's IP as Cloudflare reports it. ponytail: these headers are only
 * trustworthy while the app is reachable solely through the tunnel (S9).
 */
export function clientIp(req: Request): string {
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]
  return ip?.trim().slice(0, 64) || 'unknown'
}
