import { NextRequest, NextResponse } from 'next/server'
import { fetchQuotes } from '@/lib/yahoo-finance'
import { getCachedRoute, cacheRoute } from '@/lib/redis'
import { normalizeError } from '@/lib/errors'
import type { Position } from '@/types'
import { fetchSnapshotSeries } from '@/lib/snapshot-series'
import { fetchFlowTransactions } from '@/lib/flow-transactions'
import { fetchExternalFlows, fetchIncomeMovements } from '@/lib/cash-flows'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { enrichPositionsForStats } from '@/lib/position-stats'
import { computeTradeStats } from '@/lib/trade-stats'
import { summarizeProvenance } from '@/lib/series-provenance'
import {
  isUniverse,
  UNIVERSES,
  computeUniverseRiskMetrics,
  metricsRows,
  projectHistory,
  type FlowTransaction,
  type IncomeMovement,
} from '@/lib/asset-universe'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const authResult = await requireUser()
    if (isAuthFailure(authResult)) return authResult.error
    const { supabase, user } = authResult

    const rawUniverse = req.nextUrl.searchParams.get('universe') ?? 'measurable'
    if (!isUniverse(rawUniverse)) {
      return NextResponse.json(
        // Bounded message: never echo unbounded user input back, and name the
        // allowed values so a caller can fix the request from the response.
        { error: `Invalid universe. Allowed: ${UNIVERSES.join(', ')}` },
        { status: 400 }
      )
    }
    const universe = rawUniverse

    // v4: income now reaches the risk computation (declared coupon/dividend
    // flows). invalidateUserCache SCANs statistics:v4:{userId}:*.
    const cacheKey = `statistics:v4:${user.id}:${universe}`
    const cachedStats = await getCachedRoute(cacheKey)
    if (cachedStats) {
      return NextResponse.json(cachedStats)
    }

    // 1. Snapshots for drawdown and historical analysis — canonical read path
    const validSnapshots = await fetchSnapshotSeries(supabase, user.id)

    // 1b. Net external cash flows, to keep deposits and withdrawals out of the
    // drawdown. `snapshot.total_value` includes cash, so without this a
    // withdrawal reads as a loss and a deposit inflates the peak.
    //
    // External flows and income both come from cash-flows.ts, which documents why they are two queries.
    const externalFlows = await fetchExternalFlows(supabase, user.id)

    // Every universe except `total` has a boundary a trade or an income
    // payment can cross: stocks and ons see their own trades and coupons, and
    // `measurable` (stocks + cash) sees ON trades and CUPON/DIVIDENDO, which
    // move value into or out of cash. Only `total` contains every class, so
    // only `total` can skip these fetches.
    let flowTransactions: FlowTransaction[] = []
    let income: IncomeMovement[] = []
    if (universe !== 'total') {
      try {
        flowTransactions = await fetchFlowTransactions(supabase, user.id)
        income = await fetchIncomeMovements(supabase, user.id)
      } catch (err) {
        console.error('[Statistics] flow inputs fetch failed:', normalizeError(err).message)
        return NextResponse.json({ error: 'Failed to fetch flow inputs' }, { status: 500 })
      }
    }

    const risk = computeUniverseRiskMetrics(
      validSnapshots,
      universe,
      { externalFlows, transactions: flowTransactions, income }
    )

    // 2. Get Positions for Allocation
    const { data: positions, error: posErr } = await supabase
      .from('positions')
      .select('*')
      .eq('user_id', user.id)

    if (posErr) throw normalizeError(posErr)

    const tickers = (positions || []).map((p: Position) => p.ticker)
    const quotes = await fetchQuotes(tickers)

    // 3. Get Closed Trades
    const { data: closed, error: closedErr } = await supabase
      .from('closed_trades')
      .select('*')
      .eq('user_id', user.id)
      .order('close_date', { ascending: true })

    if (closedErr) throw normalizeError(closedErr)

    const realizedPnl = (closed || []).reduce((sum: number, t: any) => sum + (t.pnl || 0), 0)

    // Missing quotes are marked at cost (zero P&L), NEVER at 0 — a zero
    // valuation fabricates a -100% loss in every aggregate below.
    const { positions: enrichedPositions, totals } = enrichPositionsForStats(
      (positions || []) as Position[],
      quotes
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

    // All PnLs (for bar chart)
    const allPnLs = [
      ...enrichedPositions.map((p: any) => ({ ticker: p.ticker, pnl: p.pnl, pnl_pct: p.pnl_pct, status: 'OPEN' })),
      ...(closed || []).map((t: any) => ({
        ticker: t.ticker.split(':')[1] || t.ticker,
        pnl: t.pnl,
        pnl_pct: t.pnl_pct,
        status: 'CLOSED'
      }))
    ].sort((a: any, b: any) => b.pnl - a.pnl)

    const biggestWinner = allPnLs.length > 0 ? allPnLs[0] : null
    const biggestLoser = allPnLs.length > 0 ? allPnLs[allPnLs.length - 1] : null

    // === ADVANCED ANALYTICS ===

    // Closed-trade statistics: win rate, profit factor (gross/gross), holding
    // periods and monthly P&L — all from the tested pure module.
    const tradeStats = computeTradeStats(closed || [])

    // Cumulative P&L (realized + open over time from closed trades)
    let cumPnl = 0
    const cumulativePnl = (closed || []).map((t: any) => {
      cumPnl += t.pnl || 0
      return {
        date: t.close_date,
        ticker: t.ticker.split(':')[1] || t.ticker,
        pnl: t.pnl,
        cumulative: cumPnl,
      }
    })

    // Currency exposure
    const arsExposure = enrichedPositions.filter((p: any) => p.fullTicker.startsWith('BCBA:')).reduce((s: number, p: any) => s + p.market_value, 0)
    const usdExposure = totalPortfolioValue - arsExposure

    const responseData = {
      universe,
      maxDrawdown: risk.maxDrawdown,
      // How much series the figure rests on. A drawdown built from 2 intervals
      // is not comparable to one built from 200, and skipped intervals mean
      // snapshots the return series could not use.
      drawdownIntervals: risk.drawdownIntervals,
      drawdownIntervalsSkipped: risk.drawdownIntervalsSkipped,
      // What the drawdown, Sharpe and volatility figures above are made of:
      // how many days, and how many of them were reconstructed by the backfill
      // rather than measured by the daily job — over the SAME rows the risk
      // metrics used (for ons: measured only), so the provenance note
      // describes the figures beside it.
      provenance: summarizeProvenance(
        projectHistory(metricsRows(validSnapshots, universe), universe)
      ),
      // Closed-trade win rate — consistent with the W/L counts shown next to it.
      winRate: tradeStats.winRate,
      totalPortfolioValue,
      // Positions marked at cost because no quote was available — surfaced so
      // the UI can badge "N sin precio" instead of silently absorbing them.
      unpricedPositions: totals.unpricedCount,
      allocation,
      realizedPnl,
      openPnl,
      biggestWinner,
      biggestLoser,
      allPnLs,
      // New advanced data
      monthlyReturns: tradeStats.monthlyReturns,
      cumulativePnl,
      avgHoldingDays: tradeStats.avgHoldingDays,
      maxHoldingDays: tradeStats.maxHoldingDays,
      minHoldingDays: tradeStats.minHoldingDays,
      avgWin: tradeStats.avgWin,
      avgLoss: tradeStats.avgLoss,
      profitFactor: tradeStats.profitFactor,
      // Annualized, from flow-adjusted daily portfolio returns (fractions).
      sharpeRatio: risk.sharpeRatio,
      annualizedVol: risk.annualizedVol,
      returnIntervals: risk.returnIntervals,
      // Retired: stddev of monthly realized P&L in dollars was not volatility.
      monthlyStdDev: null,
      winnersCount: tradeStats.winnersCount,
      losersCount: tradeStats.losersCount,
      totalTrades: tradeStats.totalTrades,
      arsExposure,
      usdExposure,
    }

    await cacheRoute(cacheKey, responseData, 300)

    return NextResponse.json(responseData)

  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: normalizeError(err).message }, { status: 500 })
  }
}
