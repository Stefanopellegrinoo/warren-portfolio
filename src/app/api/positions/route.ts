import { NextRequest, NextResponse } from 'next/server'
import { fetchQuotesWithFallback } from '@/lib/yahoo-finance'
import { fetchONQuotesWithFallback } from '@/lib/data912-client'
import { calculatePortfolioSummary, getFullPortfolio } from '@/lib/portfolio-engine'
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
      const emptySummary = calculatePortfolioSummary([], [], new Map(), new Map(), portfolio.cashBalance, 0, 0)
      return NextResponse.json({ ...emptySummary, lastRefresh })
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

    // 5. Calculate complete portfolio summary
    const result = calculatePortfolioSummary(
      portfolio.stockPositions,
      portfolio.onPositions,
      stockQuotes,
      onQuotes,
      portfolio.cashBalance,
      stockRealizedPnl,
      onRealizedPnl
    )

    // 6. Cache the result for next time
    if (redisOk) {
      await getRedis()?.setex(`summary:${user.id}`, 600, JSON.stringify(result))
    }

    return NextResponse.json({ ...result, lastRefresh })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
