import { NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { getRedis, ensureRedisConnected } from '@/lib/redis'
import { enqueueImmediateEvaluation } from '@/lib/signals-queue'

export async function POST() {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error

  const { user } = auth

  // Per-user rate limit: 1 call per 60 seconds via Redis SET NX EX
  const redis = getRedis()
  if (redis) {
    try {
      const key = `trigger-eval:${user.id}`
      const result = await redis.set(key, '1', 'EX', 60, 'NX')
      if (result !== 'OK') {
        return NextResponse.json(
          { error: 'Rate limit: 1 request per 60 seconds' },
          { status: 429 }
        )
      }
    } catch (err) {
      // Redis error — proceed without rate limiting (graceful degradation)
      console.warn('[trigger-evaluation] Redis rate-limit check failed, proceeding:', err)
    }
  }

  // BullMQ's queue.add() hangs on the offline queue when Redis is down
  // (maxRetriesPerRequest: null) — guard explicitly instead of letting it hang
  const ready = await ensureRedisConnected()
  if (!ready) {
    return NextResponse.json(
      { error: 'Signal engine temporarily unavailable' },
      { status: 503 }
    )
  }

  await enqueueImmediateEvaluation(user.id)

  return NextResponse.json({ queued: true }, { status: 202 })
}
