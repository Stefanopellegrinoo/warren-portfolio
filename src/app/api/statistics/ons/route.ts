import { NextResponse } from 'next/server'
import { fetchONQuotesWithFallback } from '@/lib/data912-client'
import { getCachedRoute, cacheRoute } from '@/lib/redis'
import { normalizeError } from '@/lib/errors'
import { serverError } from '@/lib/api/errors'
import { loadLastCloses, loadPortfolioAndLedger } from '@/lib/ledger-now'
import { argentinaDate } from '@/lib/utils'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { enrichPositionsForStats, classIncome, resultByAsset } from '@/lib/position-stats'
import { computeTradeStats } from '@/lib/trade-stats'
import { getDerivedSeries } from '@/lib/derived-series'
import { ledgerFlows } from '@/lib/derive-history'
import { fetchFlowTransactions } from '@/lib/flow-transactions'
import { fetchIncomeMovements } from '@/lib/cash-flows'
import { computeUniverseRiskMetrics } from '@/lib/asset-universe'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const authResult = await requireUser()
    if (isAuthFailure(authResult)) return authResult.error
    const { supabase, user } = authResult

    // Check Cache First
    // v3 = income now reaches the risk computation (declared coupon/dividend
    // flows). Not bumped for incomeReceived (S7): a v3 entry without it lives
    // at most 300 s and the screen reads the field as optional.
    const cacheKey = `statistics:ons:v3:${user.id}`
    const cachedStats = await getCachedRoute(cacheKey)
    if (cachedStats) {
      return NextResponse.json(cachedStats)
    }

    // The ledger core's ON positions and sales (never the stored tables), the derived series
    // (ledger core + market data) and the declared flows do not depend on each other.
    const declaredFlows = Promise.all([fetchFlowTransactions(supabase, user.id), fetchIncomeMovements(supabase, user.id)])
      .catch((err: unknown) => normalizeError(err))
    const [{ now: portfolio, ledger }, derived, declared] = await Promise.all([
      loadPortfolioAndLedger(supabase, user.id, argentinaDate()),
      getDerivedSeries(supabase, user.id),
      declaredFlows,
    ])

    // 1. ON positions and realized sales; quotes Redis-first, data912 only for what is missing
    const positions = portfolio.onPositions
    const quotes = await fetchONQuotesWithFallback(positions.map(p => p.ticker))
    const closed = portfolio.onClosedTrades
    // Realized: the sales and the coupons (the core's automatic ones and any CUPON row), what
    // the dashboard calls realized, "con dividendos y cupones" (S7). Never the cash
    // movements' copy of a recorded coupon: that is the same money's cash leg.
    const coupons = classIncome(ledger.trades, derived.income, 'ON')
    const incomeReceived = Array.from(coupons.values()).reduce((sum, a) => sum + a, 0)
    const realizedPnl = closed.reduce((sum, t) => sum + t.pnl, 0) + incomeReceived

    // One valuation rule (S3): live quote, else last close, else cost — NEVER 0,
    // a zero valuation fabricates a -100% loss in every aggregate below.
    const { positions: enrichedPositions, totals } = enrichPositionsForStats(
      positions,
      quotes,
      await loadLastCloses(supabase, positions, quotes)
    )
    const totalPortfolioValue = totals.totalMarketValue
    const openPnl = totals.openPnl

    // Allocation
    const allocation = enrichedPositions
      .filter((p: any) => p.market_value > 0)
      .map((p: any) => ({
        name: p.ticker,
        value: p.market_value,
        pct: totalPortfolioValue > 0 ? p.market_value / totalPortfolioValue : 0
      }))
      .sort((a: any, b: any) => b.value - a.value)

    // Best and worst among open positions and single sales; the worst only if something lost.
    const operations = [
      ...enrichedPositions.map((p: any) => ({ ticker: p.ticker, pnl: p.pnl, pnl_pct: p.pnl_pct, status: 'OPEN' })),
      ...closed.map((t) => ({
        ticker: t.ticker,
        pnl: t.pnl,
        pnl_pct: t.pnl_pct,
        status: 'CLOSED'
      }))
    ].sort((a: any, b: any) => b.pnl - a.pnl)

    const biggestWinner = operations.length > 0 ? operations[0] : null
    const last = operations[operations.length - 1]
    const biggestLoser = last && last.pnl < 0 ? last : null

    // One bar per asset: open result + its sales + its coupons (S7).
    const allPnLs = resultByAsset(enrichedPositions, closed, coupons)

    // Closed-trade statistics from the tested pure module: win rate, profit
    // factor (gross/gross), holding periods and monthly P&L.
    const tradeStats = computeTradeStats(closed)

    // Cumulative P&L
    let cumPnl = 0
    const cumulativePnl = closed.map((t) => {
      cumPnl += t.pnl || 0
      return {
        date: t.close_date,
        ticker: t.ticker,
        pnl: t.pnl,
        cumulative: cumPnl,
      }
    })

    // monthlyStdDev has no per-universe equivalent yet — honest null, as before.
    const monthlyStdDev = null

    // Kept for the shared payload shape; the ONs tab does not show a market split.
    const usdExposure = totalPortfolioValue
    const arsExposure = 0

    // The core's automatic ON payments: coupons as CUPON income, amortizations as ON sales.
    if (declared instanceof Error) return serverError('Statistics ONs', declared)
    const automatic = ledgerFlows(derived.income)
    const txRows = [...declared[0], ...automatic.transactions]
    const income = [...declared[1], ...automatic.income]

    // External flows are irrelevant to the ons universe (universeFlows routes
    // ON buys/sells from transactions); pass none. Income (coupons/dividends)
    // DOES cross this boundary — a coupon moves value out of the ONs
    // universe into cash, so it must be declared or the payment reads as a loss.
    const risk = computeUniverseRiskMetrics(derived.rows, 'ons', { externalFlows: [], transactions: txRows, income })

    const responseData = {
      maxDrawdown: risk.maxDrawdown,
      winRate: tradeStats.winRate,
      totalPortfolioValue,
      unpricedPositions: totals.unpricedCount,
      unpricedTickers: enrichedPositions.filter(p => !p.priced).map(p => p.ticker),
      allocation,
      // Sales plus coupons; incomeReceived is the coupons' share of it (lifetime).
      realizedPnl,
      incomeReceived,
      openPnl,
      biggestWinner,
      biggestLoser,
      allPnLs,
      monthlyReturns: tradeStats.monthlyReturns,
      cumulativePnl,
      avgHoldingDays: tradeStats.avgHoldingDays,
      maxHoldingDays: tradeStats.maxHoldingDays,
      minHoldingDays: tradeStats.minHoldingDays,
      avgWin: tradeStats.avgWin,
      avgLoss: tradeStats.avgLoss,
      profitFactor: tradeStats.profitFactor,
      sharpeRatio: risk.sharpeRatio,
      annualizedVol: risk.annualizedVol,
      monthlyStdDev,
      winnersCount: tradeStats.winnersCount,
      losersCount: tradeStats.losersCount,
      totalTrades: tradeStats.totalTrades,
      arsExposure,
      usdExposure,
      returnIntervals: risk.returnIntervals,
      drawdownIntervals: risk.drawdownIntervals,
      // Without this the shared DetailedStats card can never surface a skipped
      // interval on the ONs tab — the universe most likely to have one, with 4
      // measured points and one already dropped for its null breakdown.
      drawdownIntervalsSkipped: risk.drawdownIntervalsSkipped,
    }

    // A degraded series (stale bars, a failed side read) is served but never pinned for 5 minutes.
    if (!derived.degraded) await cacheRoute(cacheKey, responseData, 300)

    return NextResponse.json(responseData)

  } catch (err) {
    return serverError('Statistics ONs', err)
  }
}
