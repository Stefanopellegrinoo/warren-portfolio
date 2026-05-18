import { NextRequest, NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'
import { fetchONQuotes } from '@/lib/data912-client'
import { getCachedRoute, cacheRoute } from '@/lib/redis'
import type { ONPosition, ONClosedTrade } from '@/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const supabase = createServerClientInstance()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Check Cache First
    const cacheKey = `statistics:ons:${user.id}`
    const cachedStats = await getCachedRoute(cacheKey)
    if (cachedStats) {
      console.log(`[Cache Hit] ON Statistics for ${user.id}`)
      return NextResponse.json(cachedStats)
    }

    // 1. Get ON Positions
    const { data: positions, error: posErr } = await supabase
      .from('on_positions')
      .select('*')
      .eq('user_id', user.id)

    if (posErr) throw posErr

    const tickers = (positions || []).map((p: ONPosition) => p.ticker)
    const quotes = await fetchONQuotes(tickers)

    // 2. Get ON Closed Trades
    const { data: closed, error: closedErr } = await supabase
      .from('on_closed_trades')
      .select('*')
      .eq('user_id', user.id)
      .order('close_date', { ascending: true })

    if (closedErr) throw closedErr

    const realizedPnl = (closed || []).reduce((sum: number, t: ONClosedTrade) => sum + (t.pnl || 0), 0)

    let openPnl = 0
    let winningPositions = 0
    let totalPortfolioValue = 0

    const enrichedPositions = (positions || []).map((pos: ONPosition) => {
      const quote = quotes.get(pos.ticker)
      const market_value = quote ? quote.price * pos.quantity : 0
      const pnl = market_value - pos.total_invested
      
      totalPortfolioValue += market_value
      openPnl += pnl
      if (pnl > 0) winningPositions++

      return {
        ticker: pos.ticker,
        market_value,
        pnl,
        pnl_pct: pos.total_invested > 0 ? pnl / pos.total_invested : 0
      }
    })

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

    // Monthly Realized Returns
    const monthlyReturns: { month: string; pnl: number; trades: number }[] = []
    const monthMap = new Map<string, { pnl: number; trades: number }>()
    
    for (const trade of (closed || [])) {
      const d = new Date(trade.close_date)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const existing = monthMap.get(key) || { pnl: 0, trades: 0 }
      existing.pnl += trade.pnl || 0
      existing.trades += 1
      monthMap.set(key, existing)
    }
    
    const sortedMonths = Array.from(monthMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))
    for (const [month, data] of sortedMonths) {
      monthlyReturns.push({ month, ...data })
    }

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

    // Holding period stats
    const holdingDays = (closed || []).map((t: ONClosedTrade) => t.days_held || 0)
    const avgHoldingDays = holdingDays.length > 0 ? Math.round(holdingDays.reduce((s: number, d: number) => s + d, 0) / holdingDays.length) : 0
    const maxHoldingDays = holdingDays.length > 0 ? Math.max(...holdingDays) : 0
    const minHoldingDays = holdingDays.length > 0 ? Math.min(...holdingDays) : 0

    // Win/Loss detailed
    const winners = (closed || []).filter((t: ONClosedTrade) => t.pnl > 0)
    const losers = (closed || []).filter((t: ONClosedTrade) => t.pnl < 0)
    const avgWin = winners.length > 0 ? winners.reduce((s: number, t: ONClosedTrade) => s + t.pnl, 0) / winners.length : 0
    const avgLoss = losers.length > 0 ? losers.reduce((s: number, t: ONClosedTrade) => s + t.pnl, 0) / losers.length : 0
    const profitFactor = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0

    // Volatility & Sharpe
    const monthlyPnlValues = monthlyReturns.map(m => m.pnl)
    const avgMonthlyPnl = monthlyPnlValues.length > 0 ? monthlyPnlValues.reduce((s, v) => s + v, 0) / monthlyPnlValues.length : 0
    const variance = monthlyPnlValues.length > 1
      ? monthlyPnlValues.reduce((s, v) => s + Math.pow(v - avgMonthlyPnl, 2), 0) / (monthlyPnlValues.length - 1)
      : 0
    const monthlyStdDev = Math.sqrt(variance)
    const annualizedVol = monthlyStdDev * Math.sqrt(12)
    const sharpeRatio = monthlyStdDev > 0 ? (avgMonthlyPnl - 0) / monthlyStdDev : 0

    // NOTE: ONs are USD only (Dollar-MEP), no ARS exposure
    const usdExposure = totalPortfolioValue
    const arsExposure = 0

    // Max Drawdown (simplified - would need ON snapshots for full implementation)
    const maxDrawdown = 0

    const responseData = {
      maxDrawdown,
      winRate,
      totalPortfolioValue,
      allocation,
      realizedPnl,
      openPnl,
      biggestWinner,
      biggestLoser,
      allPnLs,
      monthlyReturns,
      cumulativePnl,
      avgHoldingDays,
      maxHoldingDays,
      minHoldingDays,
      avgWin,
      avgLoss,
      profitFactor,
      sharpeRatio,
      annualizedVol,
      monthlyStdDev,
      winnersCount: winners.length,
      losersCount: losers.length,
      totalTrades: (closed || []).length,
      arsExposure,
      usdExposure,
    }

    await cacheRoute(cacheKey, responseData, 300)

    return NextResponse.json(responseData)

  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
