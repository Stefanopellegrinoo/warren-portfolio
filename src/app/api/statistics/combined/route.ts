import { NextRequest, NextResponse } from 'next/server'
import { getCachedRoute, cacheRoute } from '@/lib/redis'
import { getFullPortfolio } from '@/lib/portfolio-engine'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { serverError } from '@/lib/api/errors'

export const dynamic = 'force-dynamic'

/**
 * Open positions and closed trades per class, from the ledger core. Value, results and
 * composition are the dashboard's own answer (GET /api/positions), in the currency chosen
 * there, so both pages show one total (odd/tasks/statistics-truth.md S1).
 */
export async function GET(req: NextRequest) {
  try {
    const authResult = await requireUser()
    if (isAuthFailure(authResult)) return authResult.error
    const { supabase, user } = authResult

    const cacheKey = `statistics:combined:${user.id}`
    const cachedStats = await getCachedRoute(cacheKey)
    if (cachedStats) {
      return NextResponse.json(cachedStats)
    }

    const portfolio = await getFullPortfolio(supabase, user.id)
    const responseData = {
      stocks: { positionCount: portfolio.stockPositions.length, closedTradesCount: portfolio.stockClosedTrades.length },
      ons: { positionCount: portfolio.onPositions.length, closedTradesCount: portfolio.onClosedTrades.length },
    }

    await cacheRoute(cacheKey, responseData, 300)
    return NextResponse.json(responseData)

  } catch (err) {
    return serverError('API /statistics/combined', err)
  }
}
