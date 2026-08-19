import { NextResponse } from 'next/server'
import { fetchONQuotes } from '@/lib/data912-client'
import { getCachedRoute, cacheRoute } from '@/lib/redis'
import { normalizeError } from '@/lib/errors'
import type { ONPosition, ONClosedTrade } from '@/types'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { enrichPositionsForStats } from '@/lib/position-stats'
import { computeTradeStats } from '@/lib/trade-stats'
import { fetchSnapshotSeries } from '@/lib/snapshot-series'
import { fetchFlowTransactions } from '@/lib/flow-transactions'
import { fetchIncomeMovements } from '@/lib/cash-flows'
import {
  computeUniverseRiskMetrics,
  metricsRows,
  projectHistory,
} from '@/lib/asset-universe'
import { summarizeProvenance } from '@/lib/series-provenance'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const authResult = await requireUser()
    if (isAuthFailure(authResult)) return authResult.error
    const { supabase, user } = authResult

    // Check Cache First
    // v3 = income now reaches the risk computation (declared coupon/dividend
    // flows) and the payload carries the lifetime couponsReceived total.
    const cacheKey = `statistics:ons:v3:${user.id}`
    const cachedStats = await getCachedRoute(cacheKey)
    if (cachedStats) {
      return NextResponse.json(cachedStats)
    }

    // 1. Get ON Positions
    const { data: positions, error: posErr } = await supabase
      .from('on_positions')
      .select('*')
      .eq('user_id', user.id)

    if (posErr) throw normalizeError(posErr)

    const tickers = (positions || []).map((p: ONPosition) => p.ticker)
    const quotes = await fetchONQuotes(tickers)

    // 2. Get ON Closed Trades
    const { data: closed, error: closedErr } = await supabase
      .from('on_closed_trades')
      .select('*')
      .eq('user_id', user.id)
      .order('close_date', { ascending: true })

    if (closedErr) throw normalizeError(closedErr)

    const realizedPnl = (closed || []).reduce((sum: number, t: ONClosedTrade) => sum + (t.pnl || 0), 0)

    // Missing quotes are marked at cost (zero P&L), NEVER at 0 — a zero
    // valuation fabricates a -100% loss in every aggregate below.
    const { positions: enrichedPositions, totals } = enrichPositionsForStats(
      (positions || []) as ONPosition[],
      quotes
    )
    const totalPortfolioValue = totals.totalMarketValue
    const openPnl = totals.openPnl

    const winningPositions = enrichedPositions.filter((p) => p.pnl > 0).length
    const winRate = positions?.length ? winningPositions / positions.length : 0

    // Allocation
    const allocation = enrichedPositions
      .filter((p: any) => p.market_value > 0)
      .map((p: any) => ({
        name: p.ticker,
        value: p.market_value,
        pct: totalPortfolioValue > 0 ? p.market_value / totalPortfolioValue : 0
      }))
      .sort((a: any, b: any) => b.value - a.value)

    // All PnLs (for bar chart)
    const allPnLs = [
      ...enrichedPositions.map((p: any) => ({ ticker: p.ticker, pnl: p.pnl, pnl_pct: p.pnl_pct, status: 'OPEN' })),
      ...(closed || []).map((t: ONClosedTrade) => ({
        ticker: t.ticker,
        pnl: t.pnl,
        pnl_pct: t.pnl_pct,
        status: 'CLOSED'
      }))
    ].sort((a: any, b: any) => b.pnl - a.pnl)

    const biggestWinner = allPnLs.length > 0 ? allPnLs[0] : null
    const biggestLoser = allPnLs.length > 0 ? allPnLs[allPnLs.length - 1] : null

    // Closed-trade statistics from the tested pure module: win rate, profit
    // factor (gross/gross), holding periods and monthly P&L.
    const tradeStats = computeTradeStats(closed || [])

    // Cumulative P&L
    let cumPnl = 0
    const cumulativePnl = (closed || []).map((t: ONClosedTrade) => {
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

    // NOTE: ONs are USD only (Dollar-MEP), no ARS exposure
    const usdExposure = totalPortfolioValue
    const arsExposure = 0

    const snapshots = await fetchSnapshotSeries(supabase, user.id)

    let txRows
    let income
    try {
      txRows = await fetchFlowTransactions(supabase, user.id)
      income = await fetchIncomeMovements(supabase, user.id)
    } catch (txErr) {
      console.error('[Statistics ONs] flow inputs fetch failed:', normalizeError(txErr).message)
      return NextResponse.json({ error: 'Failed to fetch flow inputs' }, { status: 500 })
    }

    // External flows are irrelevant to the ons universe (universeFlows routes
    // ON buys/sells from transactions); pass none. Income (coupons/dividends)
    // DOES cross this boundary — a coupon moves value out of the ONs
    // universe into cash, so it must be declared or the payment reads as a loss.
    const risk = computeUniverseRiskMetrics(snapshots, 'ons', { externalFlows: [], transactions: txRows, income })

    const responseData = {
      maxDrawdown: risk.maxDrawdown,
      winRate: tradeStats.winRate,
      totalPortfolioValue,
      unpricedPositions: totals.unpricedCount,
      allocation,
      realizedPnl,
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
      provenance: summarizeProvenance(
        projectHistory(metricsRows(snapshots, 'ons'), 'ons')
      ),
      // Lifetime coupons, a NUMBER beside the metrics rather than a series:
      // the ONs chart shows what the bonds are worth, and the income that
      // left the universe is declared as having left.
      couponsReceived: income
        .filter((m) => m.type === 'CUPON')
        .reduce((sum, m) => sum + m.amount, 0),
    }

    await cacheRoute(cacheKey, responseData, 300)

    return NextResponse.json(responseData)

  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: normalizeError(err).message }, { status: 500 })
  }
}
