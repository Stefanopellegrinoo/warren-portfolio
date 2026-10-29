import { NextRequest, NextResponse } from 'next/server'
import { fetchQuotesWithFallback } from '@/lib/yahoo-finance'
import { getCachedRoute, cacheRoute } from '@/lib/redis'
import { normalizeError } from '@/lib/errors'
import { serverError } from '@/lib/api/errors'
import { loadPortfolioAndLedger } from '@/lib/ledger-now'
import { argentinaDate } from '@/lib/utils'
import { getDerivedSeries } from '@/lib/derived-series'
import { ledgerFlows } from '@/lib/derive-history'
import { fetchFlowTransactions } from '@/lib/flow-transactions'
import { fetchIncomeMovements } from '@/lib/cash-flows'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { enrichPositionsForStats, classIncome, resultByAsset } from '@/lib/position-stats'
import { computeTradeStats } from '@/lib/trade-stats'
import { isBenchmarkId, fetchBenchmarkComparison, type BenchmarkComparison } from '@/lib/benchmark'
import {
  parseUniverse,
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
        // allowed values (UNIVERSES: total, stocks, ons) in the user's words.
        { error: 'Elegí qué ver: toda la cartera, acciones u ONs' },
        { status: 400 }
      )
    }

    // Optional benchmark. The value reaches a Yahoo symbol lookup, so it is
    // matched against the whitelist — never forwarded.
    const rawBenchmark = req.nextUrl.searchParams.get('benchmark')
    if (rawBenchmark && !isBenchmarkId(rawBenchmark)) {
      return NextResponse.json({ error: 'Ese índice de comparación no está disponible' }, { status: 400 })
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

    // The derived series (ledger core + market data) for drawdown and historical analysis; the
    // net external cash flows, to keep deposits and withdrawals out of the drawdown (`total_value`
    // includes cash, so without them a withdrawal reads as a loss and a deposit inflates the
    // peak); and the positions and closed trades from the ledger core (never the stored tables).
    // External flows and income both come from cash-flows.ts, which documents why they are two queries.
    //
    // Every universe except `total` has a boundary a trade or an income payment can cross:
    // stocks and ons see their own trades and payments. Only `total` contains every class, so
    // only `total` can skip these fetches. None of these reads depends on another.
    const declaredFlows = universe === 'total'
      ? null
      : Promise.all([fetchFlowTransactions(supabase, user.id), fetchIncomeMovements(supabase, user.id)])
          .catch((err: unknown) => normalizeError(err))
    const [derived, { now: portfolio, ledger }, declared] = await Promise.all([
      getDerivedSeries(supabase, user.id),
      loadPortfolioAndLedger(supabase, user.id, argentinaDate()),
      declaredFlows,
    ])
    if (declared instanceof Error) return serverError('Statistics', declared)
    // The deposits and withdrawals the rows were built from: never a second read of the movements,
    // or a deposit moved to the purchase it paid (S10) would read as a gain on one side only.
    const externalFlows = derived.externalFlows

    const rows = derived.rows
    // The core's automatic ON payments: coupons as CUPON income, amortizations as ON sales.
    const automatic = ledgerFlows(derived.income)
    let flowTransactions: FlowTransaction[] = []
    let income: IncomeMovement[] = []
    if (declared) {
      flowTransactions = [...declared[0], ...automatic.transactions]
      income = [...declared[1], ...automatic.income]
    }

    const risk = computeUniverseRiskMetrics(
      rows,
      universe,
      { externalFlows, transactions: flowTransactions, income }
    )

    // Benchmark comparison is best-effort: a Yahoo failure costs this field,
    // never the rest of the page. It runs together with the quotes.
    const compareBenchmark = async (): Promise<{ benchmark: BenchmarkComparison | null; benchmarkError: boolean }> => {
      if (!benchmarkId) return { benchmark: null, benchmarkError: false }
      try {
        const { series } = computeUniverseTwr(rows, universe, {
          externalFlows,
          transactions: flowTransactions,
          income,
        })
        return { benchmark: await fetchBenchmarkComparison(benchmarkId, series), benchmarkError: false }
      } catch (err) {
        console.error('[Statistics] benchmark failed:', normalizeError(err).message)
        return { benchmark: null, benchmarkError: true }
      }
    }

    // Quotes as the dashboard asks for them (/api/positions): the cache, then Yahoo for what
    // it misses (S2) — a cache miss alone never values a stock at cost.
    const positions = portfolio.stockPositions
    const tickers = positions.map(p => p.ticker)
    const [{ benchmark, benchmarkError }, quotes] = await Promise.all([
      compareBenchmark(),
      tickers.length > 0 ? fetchQuotesWithFallback(tickers) : Promise.resolve(new Map()),
    ])

    // 3. Realized: the sales, in close-date order, and the stocks' dividends — what the
    // dashboard calls realized, "con dividendos y cupones" (S7).
    const closed = portfolio.stockClosedTrades
    const dividends = classIncome(ledger.trades, derived.income, 'STOCK')
    const incomeReceived = Array.from(dividends.values()).reduce((sum, a) => sum + a, 0)
    const realizedPnl = closed.reduce((sum, t) => sum + t.pnl, 0) + incomeReceived

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

    // Best and worst among open positions and single sales; the worst only if something lost.
    const operations = [
      ...enrichedPositions.map((p: any) => ({ ticker: p.ticker, pnl: p.pnl, pnl_pct: p.pnl_pct, status: 'OPEN' })),
      ...closed.map((t: any) => ({
        ticker: t.ticker.split(':')[1] || t.ticker,
        pnl: t.pnl,
        pnl_pct: t.pnl_pct,
        status: 'CLOSED'
      }))
    ].sort((a: any, b: any) => b.pnl - a.pnl)

    const biggestWinner = operations.length > 0 ? operations[0] : null
    const last = operations[operations.length - 1]
    const biggestLoser = last && last.pnl < 0 ? last : null

    // One bar per asset: open result + its sales + its dividends (S7).
    const allPnLs = resultByAsset(enrichedPositions, closed, dividends)

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

    // By market, not by currency: shares with a local BCBA ticker vs the rest.
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
      unpricedTickers: enrichedPositions.filter(p => !p.priced).map(p => p.ticker),
      allocation,
      // Sales plus dividends; incomeReceived is the dividends' share of it.
      realizedPnl,
      incomeReceived,
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
      // What the risk figures rest on (odd/tasks/statistics-truth.md S4, S5): the whole portfolio is
      // measured from the day after its last negative-cash day; with negative cash today nothing is.
      measuredFrom: risk.measuredFrom,
      measuredDays: risk.pointsUsed,
      negativeCashUntil: risk.negativeCashUntil,
      unavailableReason: risk.unavailableReason,
      degraded: derived.degraded,
      // What was missing, per asset, for the (i) on the risk row (S11).
      degradedReasons: derived.degradedReasons ?? [],
      // Deposit money moved to the purchases it paid, so the screen can say so (S10).
      fundedDeposits: universe === 'total' ? derived.fundedDeposits : null,
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
