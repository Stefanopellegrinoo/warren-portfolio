import { NextRequest, NextResponse } from 'next/server'
import { fetchQuotesWithFallback } from '@/lib/yahoo-finance'
import { fetchONQuotesWithFallback } from '@/lib/data912-client'
import { valuePortfolio } from '@/lib/portfolio-valuation'
import { loadLastCloses } from '@/lib/ledger-now'
import { getRedis, ensureRedisConnected } from '@/lib/redis'
import type { Position, ONPosition } from '@/types'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { currencyViewsFor, loadCurrencyContext, loadPortfolioForViews, type CurrencyContext, type ViewsLedger } from '@/lib/currency-views'
import { setSummaryIfVersion, summaryPayload } from '@/lib/summary-cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { serverError } from '@/lib/api/errors'
import { argentinaDate } from '@/lib/utils'

/** The Pesos / MEP / Cable views; their failure never fails the response. */
async function currencyViews(
  supabase: SupabaseClient,
  userId: string,
  ctx: CurrencyContext | null,
  valued: { positions: Position[]; onPositions: ONPosition[]; cashBalance: number },
  ledger: ViewsLedger
) {
  try {
    return ctx ? { currencies: await currencyViewsFor(supabase, userId, ctx, valued, ledger) } : {}
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
    const redis = redisOk ? getRedis() : null

    // 1. TRY REDIS CACHE (Sub-10ms path). One round trip also reads, BEFORE any ledger read, the
    //    version that guards leaving the summary computed below in Redis (same compare-and-set
    //    the worker and the derived series use), and whether an import is running.
    const [cached, lastRefreshRaw, version, importing] = redis
      ? await redis.mget(`summary:${user.id}`, 'system:last-refresh', `summary:version:${user.id}`, `importing:${user.id}`)
      : [null, null, null, null]
    const lastRefresh = lastRefreshRaw || null
    if (cached) {
      console.log(`[Cache Hit] Serving summary for ${user.id} from Redis`)
      const data = JSON.parse(cached)
      return NextResponse.json({ ...data, lastRefresh })
    }

    // 2. The portfolio now, from the ledger core (never the stored tables), read once for its
    //    currency views too; and today's dollar rates, which do not depend on it.
    const [{ portfolio, ledger }, currencyCtx] = await Promise.all([
      loadPortfolioForViews(supabase, user.id, argentinaDate()),
      loadCurrencyContext(supabase).catch(err => {
        console.error('[positions] currency views failed:', err)
        return null
      }),
    ])

    // Handle empty portfolio case
    if (portfolio.stockPositions.length === 0 && portfolio.onPositions.length === 0) {
      // Still return cash balance even if no positions
      const { positions, onPositions, summary } = valuePortfolio(
        { positions: [], onPositions: [], cashBalance: portfolio.cashBalance, realized: 0, onRealized: 0 },
        { stockQuotes: new Map(), onQuotes: new Map() }
      )
      const views = await currencyViews(supabase, user.id, currencyCtx, { positions, onPositions, cashBalance: portfolio.cashBalance }, ledger)
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
    const valued = valuePortfolio(
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
    const { positions, onPositions, summary, unpricedCount, unpricedTickers } = valued

    const views = await currencyViews(supabase, user.id, currencyCtx, { positions, onPositions, cashBalance: portfolio.cashBalance }, ledger)

    // 6. Leave the summary in Redis so the next request is a hit even when the worker does not
    //    run (evenings, weekends). Same payload and TTL as the worker, and the same guard: the
    //    write is discarded if invalidateUserCache bumped the version since it was read above.
    //    Not during an import (the worker skips it too), not without the currency views, and
    //    not with a dollar answered from its last known value: either would pin a transient
    //    state for the TTL, while the next miss brings today's.
    if (redis && !importing && views.currencies && !currencyCtx?.stale) {
      await setSummaryIfVersion(user.id, summaryPayload(valued, views.currencies), version)
        .catch(err => console.warn('[positions] summary cache write failed:', err))
    }

    return NextResponse.json({ positions, onPositions, summary, unpricedCount, unpricedTickers, lastRefresh, ...views })
  } catch (err) {
    return serverError('API /positions', err)
  }
}
