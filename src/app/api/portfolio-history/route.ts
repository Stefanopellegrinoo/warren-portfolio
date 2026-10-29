import { NextRequest, NextResponse } from 'next/server'
import { getCachedRoute, cacheRoute } from '@/lib/redis'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { getDerivedSeries } from '@/lib/derived-series'
import { argentinaDate } from '@/lib/utils'
import { contributedLine, measuredBase, parseUniverse, projectHistory, type ProjectedPoint } from '@/lib/asset-universe'
import { serverError } from '@/lib/api/errors'

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
      return NextResponse.json({ error: 'Elegí qué ver: toda la cartera, acciones u ONs' }, { status: 400 })
    }

    // v4: the whole portfolio's points carry the money put in (invalidateUserCache
    // SCANs history:v4:{userId}:*).
    const cacheKey = `history:v4:${user.id}:${daysParam}:${universe}`
    const cachedHistory = await getCachedRoute(cacheKey)
    if (cachedHistory) {
      return NextResponse.json(cachedHistory)
    }

    // Derived rows are Argentine days (argentinaDate), so the window boundary
    // is computed in the same calendar.
    const today = argentinaDate()
    // The deposits and withdrawals come with the rows they were built from (S10); only the whole
    // portfolio has them crossing its boundary.
    const { rows, degraded, externalFlows, fundedDeposits } = await getDerivedSeries(supabase, user.id, { fromDate: rangeStart(daysParam, today) })
    const flows = universe === 'total' ? externalFlows : null
    const projected: ProjectedPoint[] = projectHistory(rows, universe)
    // The whole portfolio is measured from the day after its last negative-cash day
    // (odd/tasks/statistics-truth.md S4). The series is served whole — the dashboard's value
    // chart reads it too — and says where the measured part starts; /statistics draws from there.
    const { measuredFrom, negativeCashUntil, unavailableReason } = measuredBase(rows, universe)
    // The money put in since then: /statistics draws it against the value (S9).
    const contributed = flows ? contributedLine(projected, flows, unavailableReason ? null : measuredFrom) : null
    const data = contributed ? projected.map((p, i) => ({ ...p, contributed: contributed[i] })) : projected

    const responseData = { data, measuredFrom, negativeCashUntil, unavailableReason, fundedDeposits: flows ? fundedDeposits : null }
    // A degraded series (stale bars, a failed side read) is served but never pinned for 5 minutes.
    if (!degraded) await cacheRoute(cacheKey, responseData, 300)

    return NextResponse.json(responseData)
  } catch (err) {
    return serverError('Portfolio History', err)
  }
}
