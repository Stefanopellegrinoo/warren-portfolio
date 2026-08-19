import { NextResponse } from 'next/server'
import { ensureRedisConnected } from '@/lib/redis'
import { createServiceClient } from '@/lib/supabase-server'

// Next 14 statically caches GET route handlers by default; opt out so the
// probe runs at request time and reflects live Redis/Supabase health
// (otherwise the build bakes in a 503 and the healthcheck never recovers).
export const dynamic = 'force-dynamic'

/** How long a probe result is served from memory before re-probing.
 *  Shields Redis/Supabase from rapid repeated hits on this unauthenticated
 *  endpoint (Supabase free tier 429s under load). */
const HEALTH_CACHE_TTL_MS = 10_000

interface HealthBody {
  status: 'ok' | 'degraded'
  redis: boolean
  supabase: boolean
}

let cached: { at: number; body: HealthBody; status: number } | null = null

/**
 * GET /api/health — unauthenticated health check for container orchestration.
 * Reports Redis and Supabase connectivity. Used by the Docker healthcheck.
 * The probe result is cached in-module for HEALTH_CACHE_TTL_MS.
 */
export async function GET() {
  if (cached && Date.now() - cached.at < HEALTH_CACHE_TTL_MS) {
    return NextResponse.json(cached.body, { status: cached.status })
  }

  const [redisOk, supabaseOk] = await Promise.all([checkRedis(), checkSupabase()])

  const isHealthy = redisOk && supabaseOk
  const body: HealthBody = {
    status: isHealthy ? 'ok' : 'degraded',
    redis: redisOk,
    supabase: supabaseOk,
  }
  const status = isHealthy ? 200 : 503
  cached = { at: Date.now(), body, status }

  return NextResponse.json(body, { status })
}

async function checkRedis(): Promise<boolean> {
  try {
    return await ensureRedisConnected()
  } catch {
    // A rejected probe means "not healthy", never an unhandled 500
    return false
  }
}

async function checkSupabase(): Promise<boolean> {
  try {
    const supabase = createServiceClient()
    const { error } = await supabase.from('ons').select('ticker').limit(1)
    return !error
  } catch {
    return false
  }
}
