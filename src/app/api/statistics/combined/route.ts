import { NextRequest, NextResponse } from 'next/server'
import { fetchQuotes } from '@/lib/yahoo-finance'
import { fetchONQuotesWithFallback } from '@/lib/data912-client'
import { getCachedRoute, cacheRoute } from '@/lib/redis'
import { getFullPortfolio } from '@/lib/portfolio-engine'
import { enrichPositionsForStats } from '@/lib/position-stats'
import { loadLastCloses } from '@/lib/ledger-now'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { serverError } from '@/lib/api/errors'

export const dynamic = 'force-dynamic'

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

    // Everything from the ledger core (never the stored tables), valued by the one
    // rule (S3): live quote, else last close, else cost — a missing quote is never 0.
    const portfolio = await getFullPortfolio(supabase, user.id)
    const stockPositions = portfolio.stockPositions
    const onPositions = portfolio.onPositions
    // ON quotes Redis-first (the worker's last-known prices), data912 only for what is missing.
    const [stockQuotes, onQuotes] = await Promise.all([
      fetchQuotes(stockPositions.map(p => p.ticker)),
      fetchONQuotesWithFallback(onPositions.map(p => p.ticker)),
    ])

    const stocks = enrichPositionsForStats(stockPositions, stockQuotes).totals
    const ons = enrichPositionsForStats(onPositions, onQuotes, await loadLastCloses(supabase, onPositions, onQuotes)).totals
    const stocksValue = stocks.totalMarketValue
    const stocksOpenPnl = stocks.openPnl
    const onsValue = ons.totalMarketValue
    const onsOpenPnl = ons.openPnl

    const stockClosedTrades = portfolio.stockClosedTrades
    const onClosedTrades = portfolio.onClosedTrades
    const stocksRealizedPnl = stockClosedTrades.reduce((s, t) => s + t.pnl, 0)
    const onsRealizedPnl = onClosedTrades.reduce((s, t) => s + t.pnl, 0)
    const cashBalance = portfolio.cashBalance

    const totalValue = stocksValue + onsValue + cashBalance

    const responseData = {
      totalValue,
      composition: [
        { name: 'Acciones', value: stocksValue, pct: totalValue > 0 ? stocksValue / totalValue : 0 },
        { name: 'ONs', value: onsValue, pct: totalValue > 0 ? onsValue / totalValue : 0 },
        { name: 'Efectivo', value: cashBalance, pct: totalValue > 0 ? cashBalance / totalValue : 0 },
      ].filter(c => c.value > 0),
      stocks: {
        value: stocksValue,
        openPnl: stocksOpenPnl,
        realizedPnl: stocksRealizedPnl,
        totalPnl: stocksOpenPnl + stocksRealizedPnl,
        positionCount: stockPositions.length,
        closedTradesCount: stockClosedTrades.length,
      },
      ons: {
        value: onsValue,
        openPnl: onsOpenPnl,
        realizedPnl: onsRealizedPnl,
        totalPnl: onsOpenPnl + onsRealizedPnl,
        positionCount: onPositions.length,
        closedTradesCount: onClosedTrades.length,
      },
    }

    await cacheRoute(cacheKey, responseData, 300)
    return NextResponse.json(responseData)

  } catch (err) {
    return serverError('API /statistics/combined', err)
  }
}
