import { NextRequest, NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'
import { fetchQuotes, refreshQuotes } from '@/lib/portfolio-engine'
import type { Position } from '@/types'

export async function GET(req: NextRequest) {
  try {
    const supabase = createServerClientInstance()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: positions, error } = await supabase
      .from('positions')
      .select('*')
      .eq('user_id', user.id)
      .order('total_invested', { ascending: false })

    if (error) throw error
    if (!positions?.length) return NextResponse.json({ positions: [], summary: null })

    // Fetch live prices
    const tickers = positions.map((p: Position) => p.ticker)
    const quotes = await fetchQuotes(tickers)
    
    // Trigger background refresh for next time or if any are missing
    refreshQuotes(tickers)

    // Enrich positions
    const enriched: Position[] = positions.map((pos: Position) => {
      const price = quotes.get(pos.ticker)
      const market_value = price ? price * pos.quantity : undefined
      const pnl = market_value !== undefined ? market_value - pos.total_invested : undefined
      const pnl_pct = pnl !== undefined && pos.total_invested > 0 ? pnl / pos.total_invested : undefined

      return { ...pos, current_price: price, market_value, pnl, pnl_pct }
    })

    // Summary
    const withPrices = enriched.filter(p => p.market_value !== undefined)
    const total_market_value = withPrices.reduce((s, p) => s + (p.market_value ?? 0), 0)
    const total_invested = enriched.reduce((s, p) => s + p.total_invested, 0)
    const open_pnl = total_market_value - total_invested
    const open_pnl_pct = total_invested > 0 ? open_pnl / total_invested : 0

    // Realized PnL
    const { data: closed } = await supabase
      .from('closed_trades')
      .select('pnl')
      .eq('user_id', user.id)

    const realized_pnl = (closed ?? []).reduce((s: number, t: { pnl: number }) => s + (t.pnl ?? 0), 0)

    const sorted = [...withPrices].sort((a, b) => (b.pnl_pct ?? 0) - (a.pnl_pct ?? 0))

    return NextResponse.json({
      positions: enriched,
      summary: {
        total_market_value,
        total_invested,
        open_pnl,
        open_pnl_pct,
        realized_pnl,
        positions_count: enriched.length,
        best_performer: sorted[0] ?? null,
        worst_performer: sorted[sorted.length - 1] ?? null,
      },
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
