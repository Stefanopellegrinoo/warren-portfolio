import { NextRequest, NextResponse } from 'next/server'
import { getCachedRoute, cacheRoute } from '@/lib/redis'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { snapshotUser } from '@/lib/portfolio-snapshots'
import { getDerivedSeries } from '@/lib/derived-series'
import { argentinaDate } from '@/lib/utils'
import { parseUniverse, projectHistory, type ProjectedPoint } from '@/lib/asset-universe'

// GET: the portfolio evolution series, derived from the ledger core
// (getDerivedSeries) — the same rows the statistics read. It starts at the
// user's first ledger date and ends with today's row at live quotes: "today"
// and every past day are one computation.
export const dynamic = 'force-dynamic'

// Cap to max 730 days (2 years) to prevent resource exhaustion
const MAX_DAYS = 730

/** Inclusive YYYY-MM-DD lower bound for the requested window, in Argentine days. */
function rangeStart(daysParam: string, today: string): string | undefined {
  if (daysParam === 'all') return undefined
  const cutoff = new Date(`${today}T00:00:00Z`)
  cutoff.setUTCDate(cutoff.getUTCDate() - parseInt(daysParam))
  return cutoff.toISOString().split('T')[0]
}

export async function GET(req: NextRequest) {
  try {
    const authResult = await requireUser()
    if (isAuthFailure(authResult)) return authResult.error
    const { supabase, user } = authResult

    const { searchParams } = new URL(req.url)
    const rawDays = searchParams.get('days') ?? '90'
    const daysParam =
      rawDays === 'all' ? 'all' : String(Math.max(1, Math.min(parseInt(rawDays) || 90, MAX_DAYS)))

    const universe = parseUniverse(searchParams.get('universe'))
    if (!universe) {
      return NextResponse.json({ error: 'Invalid universe' }, { status: 400 })
    }

    // v3: points are projected per-universe via projectHistory (invalidateUserCache
    // SCANs history:v3:{userId}:*).
    const cacheKey = `history:v3:${user.id}:${daysParam}:${universe}`
    const cachedHistory = await getCachedRoute(cacheKey)
    if (cachedHistory) {
      return NextResponse.json(cachedHistory)
    }

    // Derived rows are Argentine days (argentinaDate), so the window boundary
    // is computed in the same calendar.
    const today = argentinaDate()
    const { rows, degraded } = await getDerivedSeries(supabase, user.id, { fromDate: rangeStart(daysParam, today) })
    const data: ProjectedPoint[] = projectHistory(rows, universe)

    const responseData = { data }
    // A degraded series (stale bars, a failed side read) is served but never pinned for 5 minutes.
    if (!degraded) await cacheRoute(cacheKey, responseData, 300)

    return NextResponse.json(responseData)
  } catch (err) {
    console.error('[Portfolio History] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// POST: take a snapshot of the current portfolio value for the caller.
//
// The daily snapshot job (src/lib/portfolio-snapshots.ts) writes the same table
// on a schedule; this route is the manual trigger for the same user. Both MUST
// value the portfolio identically — stocks + ONs + cash — or the max-drawdown
// series would mix two different definitions of "portfolio value" depending on
// which writer touched a given day.
export async function POST(req: NextRequest) {
  try {
    const authResult = await requireUser()
    if (isAuthFailure(authResult)) return authResult.error
    const { supabase, user } = authResult

    // Argentine day, matching the scheduled job — a UTC date here would stamp a
    // late-evening manual snapshot with tomorrow's date.
    const result = await snapshotUser(supabase, user.id, argentinaDate())

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json(result.snapshot, { status: 201 })
  } catch (err) {
    console.error('[Portfolio History] POST error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
