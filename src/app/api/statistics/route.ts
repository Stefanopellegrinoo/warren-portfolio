import { NextRequest, NextResponse } from 'next/server'
import { fetchQuotes } from '@/lib/yahoo-finance'
import { getCachedRoute, cacheRoute } from '@/lib/redis'
import { normalizeError } from '@/lib/errors'
import { serverError } from '@/lib/api/errors'
import { getFullPortfolio } from '@/lib/portfolio-engine'
import { getDerivedSeries } from '@/lib/derived-series'
import { ledgerFlows } from '@/lib/derive-history'
import { fetchFlowTransactions } from '@/lib/flow-transactions'
import { fetchExternalFlows, fetchIncomeMovements } from '@/lib/cash-flows'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { enrichPositionsForStats } from '@/lib/position-stats'
import { computeTradeStats } from '@/lib/trade-stats'
import { isBenchmarkId, fetchBenchmarkComparison, type BenchmarkComparison } from '@/lib/benchmark'
import {
  parseUniverse,
  UNIVERSES,
  computeUniverseRiskMetrics,
  computeUniverseTwr,
  type FlowTransaction,
  type IncomeMovement,
} from '@/lib/asset-universe'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const authResult = await requireUser()
    if (isAuthFailure(authResult)) return authResult.error
    const { supabase, user } = authResult

    // Default and the retired `measurable`: the whole portfolio (S9).
    const universe = parseUniverse(req.nextUrl.searchParams.get('universe'))
    if (!universe) {
      return NextResponse.json(
        // Bounded message: never echo unbounded user input back, and name the
        // allowed values so a caller can fix the request from the response.
        { error: `Invalid universe. Allowed: ${UNIVERSES.join(', ')}` },
        { status: 400 }
      )
    }

    // Optional benchmark. The value reaches a Yahoo symbol lookup, so it is
    // matched against the whitelist — never forwarded.
    const rawBenchmark = req.nextUrl.searchParams.get('benchmark')
    if (rawBenchmark && !isBenchmarkId(rawBenchmark)) {
      return NextResponse.json({ error: 'Invalid benchmark' }, { status: 400 })
    }
    const benchmarkId = rawBenchmark && isBenchmarkId(rawBenchmark) ? rawBenchmark : null

    // v4: income now reaches the risk computation (declared coupon/dividend
    // flows). invalidateUserCache SCANs statistics:v4:{userId}:*.
    // The benchmark suffix keeps the same prefix, so that SCAN still clears it.
    const cacheKey = `statistics:v4:${user.id}:${universe}${benchmarkId ? `:${benchmarkId}` : ''}`
    const cachedStats = await getCachedRoute(cacheKey)
    if (cachedStats) {
      return NextResponse.json(cachedStats)
    }

    // 1. The derived series (ledger core + market data) for drawdown and historical analysis
    const derived = await getDerivedSeries(supabase, user.id)
    const rows = derived.rows
    // The core's automatic ON payments: coupons as CUPON income, amortizations as ON sales.
    const automatic = ledgerFlows(derived.income)

    // 1b. Net external cash flows, to keep deposits and withdrawals out of the
    // drawdown. `total_value` includes cash, so without this a
    // withdrawal reads as a loss and a deposit inflates the peak.
    //
    // External flows and income both come from cash-flows.ts, which documents why they are two queries.
    const externalFlows = await fetchExternalFlows(supabase, user.id)

    // Every universe except `total` has a boundary a trade or an income
    // payment can cross: stocks and ons see their own trades and payments.
    // Only `total` contains every class, so only `total` can skip these fetches.
    let flowTransactions: FlowTransaction[] = []
    let income: IncomeMovement[] = []
    if (universe !== 'total') {
      try {
        flowTransactions = [...(await fetchFlowTransactions(supabase, user.id)), ...automatic.transactions]
        income = [...(await fetchIncomeMovements(supabase, user.id)), ...automatic.income]
      } catch (err) {
        console.error('[Statistics] flow inputs fetch failed:', normalizeError(err).message)
        return NextResponse.json({ error: 'Failed to fetch flow inputs' }, { status: 500 })
      }
    }

    const risk = computeUniverseRiskMetrics(
      rows,
      universe,
      { externalFlows, transactions: flowTransactions, income }
    )

    // Benchmark comparison is best-effort: a Yahoo failure costs this field,
    // never the rest of the page.
    let benchmark: BenchmarkComparison | null = null
    let benchmarkError = false
    if (benchmarkId) {
      try {
        const { series } = computeUniverseTwr(rows, universe, {
          externalFlows,
          transactions: flowTransactions,
          income,
        })
        benchmark = await fetchBenchmarkComparison(benchmarkId, series)
      } catch (err) {
        console.error('[Statistics] benchmark failed:', normalizeError(err).message)
        benchmarkError = true
      }
    }

    // 2. Positions and closed trades from the ledger core (never the stored tables)
    const portfolio = await getFullPortfolio(supabase, user.id)
    const positions = portfolio.stockPositions
    const quotes = await fetchQuotes(positions.map(p => p.ticker))

    // 3. Realized sales, in close-date order
    const closed = portfolio.stockClosedTrades
    const realizedPnl = closed.reduce((sum, t) => sum + t.pnl, 0)

    // One valuation rule (S3): live quote, else last close, else cost — NEVER 0,
    // a zero valuation fabricates a -100% loss in every aggregate below.
    const { positions: enrichedPositions, totals } = enrichPositionsForStats(positions, quotes)
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
      ...closed.map((t: any) => ({
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
    const tradeStats = computeTradeStats(closed)

    // Cumulative P&L (realized + open over time from closed trades)
    let cumPnl = 0
    const cumulativePnl = closed.map((t: any) => {
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
      // days the return series could not use.
      drawdownIntervals: risk.drawdownIntervals,
      drawdownIntervalsSkipped: risk.drawdownIntervalsSkipped,
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
      benchmark,
      benchmarkError,
    }

    // Do not pin a transient benchmark failure or a degraded series in the cache for 5 minutes.
    if (!benchmarkError && !derived.degraded) await cacheRoute(cacheKey, responseData, 300)

    return NextResponse.json(responseData)

  } catch (err) {
    return serverError('Statistics', err)
  }
}
