import { NextResponse } from 'next/server'
import { ensureRedisConnected } from '@/lib/redis'
import { readBeat } from '@/lib/job-health'
import { createServiceClient } from '@/lib/supabase-server'
import { readOnTermsFreshness, type OnTermsFreshness } from '@/lib/on-terms-health'
import { argentinaDate } from '@/lib/utils'

// Next 14 statically caches GET route handlers by default; opt out so the
// probe runs at request time and reflects live Redis/Supabase health
// (otherwise the build bakes in a 503 and the healthcheck never recovers).
export const dynamic = 'force-dynamic'

/** How long a probe result is served from memory before re-probing.
 *  Shields Redis/Supabase from rapid repeated hits on this unauthenticated
 *  endpoint (Supabase free tier 429s under load). A healthy answer is kept five
 *  minutes: the Docker healthcheck asks every 30 s, and the database is small and
 *  short of memory, so it should not be asked that often. A degraded one only ten
 *  seconds, so a recovery shows at once. The cost: an outage shows here up to five
 *  minutes late (nothing restarts the app on this status; a new container probes fresh). */
const HEALTHY_TTL_MS = 5 * 60_000
const DEGRADED_TTL_MS = 10_000

interface HealthBody {
  status: 'ok' | 'degraded'
  redis: boolean
  supabase: boolean
  /** Informational only: a stale worker must never fail the Docker healthcheck. */
  worker: { lastBeat: string | null; stale: boolean }
  /** Informational only (never affects status): freshness of the ON terms catalog. Omitted when unreadable. */
  onTerms?: OnTermsFreshness
}

let cached: { at: number; body: HealthBody; status: number } | null = null

/**
 * GET /api/health — unauthenticated health check for container orchestration.
 * Reports Redis and Supabase connectivity. Used by the Docker healthcheck.
 * The probe result is cached in-module: HEALTHY_TTL_MS when healthy, DEGRADED_TTL_MS when not.
 */
export async function GET() {
  if (cached && Date.now() - cached.at < (cached.status === 200 ? HEALTHY_TTL_MS : DEGRADED_TTL_MS)) {
    return NextResponse.json(cached.body, { status: cached.status })
  }

  const [redisOk, supabaseOk, worker, onTerms] = await Promise.all([checkRedis(), checkSupabase(), readBeat(), checkOnTerms()])

  const isHealthy = redisOk && supabaseOk
  const body: HealthBody = {
    status: isHealthy ? 'ok' : 'degraded',
    redis: redisOk,
    supabase: supabaseOk,
    worker,
    ...(onTerms ? { onTerms } : {}),
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

async function checkOnTerms(): Promise<OnTermsFreshness | null> {
  try {
    return await readOnTermsFreshness(createServiceClient(), argentinaDate())
  } catch {
    return null
  }
}
