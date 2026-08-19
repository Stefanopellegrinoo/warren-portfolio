import { NextRequest, NextResponse } from 'next/server'
import { fetchQuotesWithFallback } from '@/lib/yahoo-finance'
import { fetchONQuotesWithFallback } from '@/lib/data912-client'
import { getFullPortfolio } from '@/lib/portfolio-engine'
import { valuePortfolio } from '@/lib/portfolio-valuation'
import { getRedis, ensureRedisConnected } from '@/lib/redis'
import type { Position, ONPosition } from '@/types'
import { requireUser, isAuthFailure } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const authResult = await requireUser()
    if (isAuthFailure(authResult)) return authResult.error
    const { supabase, user } = authResult

    // ENSURE REDIS IS CONNECTED before any reads
    const redisOk = await ensureRedisConnected()

    // 1. TRY REDIS CACHE (Sub-10ms path)
    if (redisOk) {
      const redis = getRedis()
      const cached = await redis?.get(`summary:${user.id}`)
      if (cached) {
        console.log(`[Cache Hit] Serving summary for ${user.id} from Redis`)
        const data = JSON.parse(cached)
        const lr = await redis?.get('system:last-refresh')
        return NextResponse.json({ ...data, lastRefresh: lr || null })
      }
    }

    // 2. Fetch all portfolio data in parallel
    const portfolio = await getFullPortfolio(supabase, user.id)

    // Get last refresh timestamp
    let lastRefresh: string | null = null
    if (redisOk) {
      const lr = await getRedis()?.get('system:last-refresh')
      if (lr) lastRefresh = lr
    }

    // Handle empty portfolio case
    if (portfolio.stockPositions.length === 0 && portfolio.onPositions.length === 0) {
      // Still return cash balance even if no positions
      const { positions, onPositions, summary } = valuePortfolio(
        { positions: [], onPositions: [], cashBalance: portfolio.cashBalance, realized: 0, onRealized: 0 },
        { stockQuotes: new Map(), onQuotes: new Map() },
        { missingQuotePolicy: 'drop' }
      )
      return NextResponse.json({ positions, onPositions, summary, lastRefresh })
    }

    // 3. Fetch quotes for stocks and ONs in parallel
    const stockTickers = portfolio.stockPositions.map((p: Position) => p.ticker)
    const onTickers = portfolio.onPositions.map((p: ONPosition) => p.ticker)

    const [stockQuotes, onQuotes] = await Promise.all([
      stockTickers.length > 0 ? fetchQuotesWithFallback(stockTickers) : Promise.resolve(new Map()),
      onTickers.length > 0 ? fetchONQuotesWithFallback(onTickers) : Promise.resolve(new Map()),
    ])

    // 4. Calculate realized P&L from closed trades
    const stockRealizedPnl = portfolio.stockClosedTrades.reduce(
      (sum: number, t: { pnl: number }) => sum + (t.pnl ?? 0), 0
    )
    const onRealizedPnl = portfolio.onClosedTrades.reduce(
      (sum: number, t: { pnl: number }) => sum + (t.pnl ?? 0), 0
    )

    // 5. Calculate complete portfolio summary — canonical entry, policy 'drop':
    // quotes pass through untouched, unpriced positions fall out of the totals
    // exactly as before (no displayed dashboard number changes).
    const { positions, onPositions, summary } = valuePortfolio(
      {
        positions: portfolio.stockPositions,
        onPositions: portfolio.onPositions,
        cashBalance: portfolio.cashBalance,
        realized: stockRealizedPnl,
        onRealized: onRealizedPnl,
      },
      { stockQuotes, onQuotes },
      { missingQuotePolicy: 'drop' }
    )

    // 6. NEVER cache from the API route — the worker is the single source of truth.
    //    If the API route cached here, it could race with invalidateUserCache()
    //    and produce inconsistent snapshots (e.g. missing positions after a buy).
    //    The worker's cacheUserSummaries is the only writer for summary:* keys.

    return NextResponse.json({ positions, onPositions, summary, lastRefresh })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
