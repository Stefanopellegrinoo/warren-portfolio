import { NextRequest, NextResponse } from 'next/server'
import { fetchQuotes } from '@/lib/yahoo-finance'
import { fetchONQuotes } from '@/lib/data912-client'
import { getCachedRoute, cacheRoute } from '@/lib/redis'
import type { Position, ONPosition } from '@/types'
import { requireUser, isAuthFailure } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const authResult = await requireUser()
    if (isAuthFailure(authResult)) return authResult.error
    const { supabase, user } = authResult

    const cacheKey = `statistics:combined:${user.id}`
    const cachedStats = await getCachedRoute(cacheKey)
    if (cachedStats) {
      console.log(`[Cache Hit] Combined Statistics for ${user.id}`)
      return NextResponse.json(cachedStats)
    }

    // Fetch stock positions
    const { data: stockPositions } = await supabase
      .from('positions')
      .select('*')
      .eq('user_id', user.id)

    const stockTickers = (stockPositions || []).map((p: Position) => p.ticker)
    const stockQuotes = await fetchQuotes(stockTickers)

    let stocksValue = 0
    let stocksOpenPnl = 0
    for (const pos of (stockPositions || [])) {
      const quote = stockQuotes.get(pos.ticker)
      if (quote) {
        const mv = quote.price * pos.quantity
        stocksValue += mv
        stocksOpenPnl += (mv - pos.total_invested)
      }
    }

    // Fetch stock closed trades
    const { data: stockClosedTrades } = await supabase
      .from('closed_trades')
      .select('pnl')
      .eq('user_id', user.id)
    const stocksRealizedPnl = (stockClosedTrades || []).reduce((s: number, t: any) => s + (t.pnl || 0), 0)

    // Fetch ON positions
    const { data: onPositions } = await supabase
      .from('on_positions')
      .select('*')
      .eq('user_id', user.id)

    const onTickers = (onPositions || []).map((p: ONPosition) => p.ticker)
    const onQuotes = await fetchONQuotes(onTickers)

    let onsValue = 0
    let onsOpenPnl = 0
    for (const pos of (onPositions || [])) {
      const quote = onQuotes.get(pos.ticker)
      if (quote) {
        const mv = quote.price * pos.quantity
        onsValue += mv
        onsOpenPnl += (mv - pos.total_invested)
      }
    }

    // Fetch ON closed trades
    const { data: onClosedTrades } = await supabase
      .from('on_closed_trades')
      .select('pnl')
      .eq('user_id', user.id)
    const onsRealizedPnl = (onClosedTrades || []).reduce((s: number, t: any) => s + (t.pnl || 0), 0)

    // TODO: Fetch cash balance (if implemented)
    const cashBalance = 0

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
        positionCount: (stockPositions || []).length,
        closedTradesCount: (stockClosedTrades || []).length,
      },
      ons: {
        value: onsValue,
        openPnl: onsOpenPnl,
        realizedPnl: onsRealizedPnl,
        totalPnl: onsOpenPnl + onsRealizedPnl,
        positionCount: (onPositions || []).length,
        closedTradesCount: (onClosedTrades || []).length,
      },
    }

    await cacheRoute(cacheKey, responseData, 300)
    return NextResponse.json(responseData)

  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
