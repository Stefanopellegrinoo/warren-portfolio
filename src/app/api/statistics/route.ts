import { NextRequest, NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'
import { fetchQuotes } from '@/lib/yahoo-finance'
import { getCachedRoute, cacheRoute } from '@/lib/redis'
import type { Position, PortfolioSnapshot } from '@/types'

export async function GET(req: NextRequest) {
  try {
    const supabase = createServerClientInstance()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Check Cache First
    const cacheKey = `statistics:${user.id}`
    const cachedStats = await getCachedRoute(cacheKey)
    if (cachedStats) {
      console.log(`[Cache Hit] Statistics for ${user.id}`)
      return NextResponse.json(cachedStats)
    }

    // 1. Get Snapshots for Drawdown and CAGR approximation
    const { data: snapshots, error: snapErr } = await supabase
      .from('portfolio_snapshots')
      .select('*')
      .eq('user_id', user.id)
      .order('snapshot_date', { ascending: true })

    if (snapErr) throw snapErr

    let maxDrawdown = 0
    let peakValue = 0

    const validSnapshots = (snapshots as PortfolioSnapshot[]) || []
    
    for (const snap of validSnapshots) {
      if (snap.total_value > peakValue) {
        peakValue = snap.total_value
      }
      
      if (peakValue > 0) {
        const drawdown = (snap.total_value - peakValue) / peakValue
        if (drawdown < maxDrawdown) {
          maxDrawdown = drawdown
        }
      }
    }

    // 2. Get Positions for Allocation and Win Rate
    const { data: positions, error: posErr } = await supabase
      .from('positions')
      .select('*')
      .eq('user_id', user.id)

    if (posErr) throw posErr

    const tickers = (positions || []).map((p: Position) => p.ticker)
    const quotes = await fetchQuotes(tickers)

    // 3. Get Closed Trades for Realized PnL and historical best/worst
    const { data: closed, error: closedErr } = await supabase
      .from('closed_trades')
      .select('*')
      .eq('user_id', user.id)

    if (closedErr) throw closedErr

    const realizedPnl = (closed || []).reduce((sum, t) => sum + (t.pnl || 0), 0)

    let openPnl = 0
    let winningPositions = 0
    let totalPortfolioValue = 0

    const enrichedPositions = (positions || []).map((pos: Position) => {
      const quote = quotes.get(pos.ticker)
      const market_value = quote ? quote.price * pos.quantity : 0
      const pnl = market_value - pos.total_invested
      
      totalPortfolioValue += market_value
      openPnl += pnl
      if (pnl > 0) winningPositions++

      return {
        ticker: pos.ticker.split(':')[1] || pos.ticker,
        market_value,
        pnl,
        pnl_pct: pos.total_invested > 0 ? pnl / pos.total_invested : 0
      }
    })

    const winRate = positions?.length ? winningPositions / positions.length : 0

    // Calculate allocation percentages
    const allocation = enrichedPositions
      .filter(p => p.market_value > 0)
      .map(p => ({
        name: p.ticker,
        value: p.market_value,
        pct: totalPortfolioValue > 0 ? p.market_value / totalPortfolioValue : 0
      }))
      .sort((a, b) => b.value - a.value)

    // Combine all PnLs to find Biggest Winner & Loser
    const allPnLs = [
      ...enrichedPositions.map(p => ({ ticker: p.ticker, pnl: p.pnl, pnl_pct: p.pnl_pct, status: 'OPEN' })),
      ...(closed || []).map(t => ({ 
        ticker: t.ticker.split(':')[1] || t.ticker, 
        pnl: t.pnl, 
        pnl_pct: t.pnl_pct, 
        status: 'CLOSED' 
      }))
    ].sort((a, b) => b.pnl - a.pnl) // Descending by PnL USD

    const biggestWinner = allPnLs.length > 0 ? allPnLs[0] : null
    const biggestLoser = allPnLs.length > 0 ? allPnLs[allPnLs.length - 1] : null

    const responseData = {
      maxDrawdown,
      winRate,
      totalPortfolioValue,
      allocation,
      realizedPnl,
      openPnl,
      biggestWinner,
      biggestLoser,
      allPnLs // Return for the bar chart
    }

    await cacheRoute(cacheKey, responseData, 300) // 5 minutes cache

    return NextResponse.json(responseData)

  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
