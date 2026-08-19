import { NextRequest, NextResponse } from 'next/server'
import { getCachedRoute, cacheRoute } from '@/lib/redis'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { snapshotUser, computeLiveSnapshotRow } from '@/lib/portfolio-snapshots'
import { fetchSnapshotSeries } from '@/lib/snapshot-series'
import { argentinaDate } from '@/lib/utils'
import { isUniverse, projectHistory, type ProjectedPoint } from '@/lib/asset-universe'

// GET: the portfolio evolution series, read from portfolio_snapshots — the
// same rows the max-drawdown statistic uses — plus a live intraday point for
// today when the daily job hasn't written it yet. The old transaction-replay
// implementation (activeTickers survivorship filter, per-ticker historical
// quotes, || 0 price fallback) is gone: snapshots are the single source of
// portfolio value, and they already include stocks + ONs + cash with missing
// quotes marked at avg_cost.
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

    const rawUniverse = searchParams.get('universe') ?? 'total'
    if (!isUniverse(rawUniverse)) {
      return NextResponse.json({ error: 'Invalid universe' }, { status: 400 })
    }
    const universe = rawUniverse

    // v3: points are projected per-universe via projectHistory. Without the
    // bump, cached v2 entries serve the old total_value/pnl shape for 300s
    // regardless of universe — the exact silent degradation this feature
    // exists to prevent.
    const cacheKey = `history:v3:${user.id}:${daysParam}:${universe}`
    const cachedHistory = await getCachedRoute(cacheKey)
    if (cachedHistory) {
      return NextResponse.json(cachedHistory)
    }

    // Snapshot dates are Argentine days (argentinaDate stamps the writers),
    // so the window boundary must be computed in the same calendar.
    const today = argentinaDate()
    const snapshots = await fetchSnapshotSeries(supabase, user.id, {
      fromDate: rangeStart(daysParam, today),
    })

    const data: ProjectedPoint[] = projectHistory(snapshots, universe)

    // Live intraday point: only when today's snapshot is absent (the series is
    // ascending, so today can only be the last row — but a universe whose
    // today-row was dropped by projectHistory must still get the live point).
    // A live-valuation failure degrades to the snapshot series alone — it
    // never blanks the chart.
    const hasToday = data.length > 0 && data[data.length - 1].snapshot_date === today
    if (!hasToday) {
      try {
        const liveRow = await computeLiveSnapshotRow(supabase, user.id, today)
        if (liveRow) {
          // A measurement, not a reconstruction: computeLiveSnapshotRow
          // values the portfolio from real current quotes.
          const [livePoint] = projectHistory(
            [{ ...liveRow, source: 'live' as const }],
            universe
          )
          if (livePoint) data.push(livePoint)
        }
      } catch (err) {
        console.error('[Portfolio History] Live point failed — serving snapshots only:', err)
      }
    }

    const responseData = { data }
    await cacheRoute(cacheKey, responseData, 300)

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
