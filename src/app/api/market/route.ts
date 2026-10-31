import { NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'
import { MARKET_DATA_UNAVAILABLE, serverError } from '@/lib/api/errors'
import { loadMarketBoard } from '@/lib/market-board'

export const dynamic = 'force-dynamic'

// Signed-in users only, limited per user; the board itself is one shared Redis copy (market-board.ts).
const ROUTE_LIMIT = 60
const ROUTE_WINDOW_SEC = 60

/** The Mercado board: Panel líder, local shares and CEDEAR peso lines in pesos, MEP/CCL and the market state. */
export async function GET() {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error
  if (!(await rateLimit(`rl:market:${authResult.user.id}`, ROUTE_LIMIT, ROUTE_WINDOW_SEC))) {
    return tooManyRequests(ROUTE_WINDOW_SEC)
  }
  try {
    const board = await loadMarketBoard()
    if (!board) {
      return NextResponse.json({ error: MARKET_DATA_UNAVAILABLE }, { status: 503, headers: { 'Retry-After': String(ROUTE_WINDOW_SEC) } })
    }
    return NextResponse.json(board)
  } catch (err) {
    return serverError('API /market', err)
  }
}
