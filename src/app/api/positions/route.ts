import { NextRequest, NextResponse } from 'next/server'
import { fetchQuotesWithFallback } from '@/lib/yahoo-finance'
import { fetchONQuotesWithFallback } from '@/lib/data912-client'
import { getFullPortfolio } from '@/lib/portfolio-engine'
import { valuePortfolio } from '@/lib/portfolio-valuation'
import { loadLastCloses } from '@/lib/ledger-now'
import { getRedis, ensureRedisConnected } from '@/lib/redis'
import type { Position, ONPosition } from '@/types'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { currencyViewsFor, loadCurrencyContext } from '@/lib/currency-views'
import type { SupabaseClient } from '@supabase/supabase-js'
import { serverError } from '@/lib/api/errors'

/** The Pesos / MEP / Cable views; their failure never fails the response. */
async function currencyViews(
  supabase: SupabaseClient,
  userId: string,
  valued: { positions: Position[]; onPositions: ONPosition[]; cashBalance: number }
) {
  try {
    const ctx = await loadCurrencyContext(supabase)
    return ctx ? { currencies: await currencyViewsFor(supabase, userId, ctx, valued) } : {}
  } catch (err) {
    console.error('[positions] currency views failed:', err)
    return {}
  }
}

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

    // 2. The portfolio now, from the ledger core (never the stored tables)
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
        { stockQuotes: new Map(), onQuotes: new Map() }
      )
      const views = await currencyViews(supabase, user.id, { positions, onPositions, cashBalance: portfolio.cashBalance })
      return NextResponse.json({ positions, onPositions, summary, lastRefresh, ...views })
    }

    // 3. Fetch quotes for stocks and ONs in parallel
    const stockTickers = portfolio.stockPositions.map((p: Position) => p.ticker)
    const onTickers = portfolio.onPositions.map((p: ONPosition) => p.ticker)

    const [stockQuotes, onQuotes] = await Promise.all([
      stockTickers.length > 0 ? fetchQuotesWithFallback(stockTickers) : Promise.resolve(new Map()),
      onTickers.length > 0 ? fetchONQuotesWithFallback(onTickers) : Promise.resolve(new Map()),
    ])

    // 4. Realized P&L from the ledger core's sales
    const stockRealizedPnl = portfolio.stockClosedTrades.reduce(
      (sum: number, t: { pnl: number }) => sum + (t.pnl ?? 0), 0
    )
    const onRealizedPnl = portfolio.onClosedTrades.reduce(
      (sum: number, t: { pnl: number }) => sum + (t.pnl ?? 0), 0
    )

    // 5. Complete portfolio summary — one valuation rule (S3): live quote, else
    // last close, else the position's own cost. Unpriced positions are counted.
    const { positions, onPositions, summary, unpricedCount, unpricedTickers } = valuePortfolio(
      {
        positions: portfolio.stockPositions,
        onPositions: portfolio.onPositions,
        cashBalance: portfolio.cashBalance,
        realized: stockRealizedPnl,
        onRealized: onRealizedPnl,
      },
      { stockQuotes, onQuotes },
      await loadLastCloses(supabase, portfolio.onPositions, onQuotes)
    )

    // 6. NEVER cache from the API route — the worker is the single source of truth.
    //    If the API route cached here, it could race with invalidateUserCache()
    //    and produce inconsistent snapshots (e.g. missing positions after a buy).
    //    The worker's cacheUserSummaries is the only writer for summary:* keys.

    const views = await currencyViews(supabase, user.id, { positions, onPositions, cashBalance: portfolio.cashBalance })
    return NextResponse.json({ positions, onPositions, summary, unpricedCount, unpricedTickers, lastRefresh, ...views })
  } catch (err) {
    return serverError('API /positions', err)
  }
}
