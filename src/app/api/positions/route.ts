import { NextRequest, NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'
import { fetchQuotes } from '@/lib/yahoo-finance'
import { calculatePortfolioSummary } from '@/lib/portfolio-engine'
import { getRedis, isRedisReady } from '@/lib/redis'
import type { Position } from '@/types'

export async function GET(req: NextRequest) {
  try {
    const supabase = createServerClientInstance()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // 1. TRY REDIS CACHE (Sub-10ms path)
    if (isRedisReady()) {
      const cached = await getRedis()?.get(`summary:${user.id}`)
      if (cached) {
        console.log(`[Cache Hit] Serving summary for ${user.id} from Redis`)
        return NextResponse.json(JSON.parse(cached))
      }
    }

    // 2. FALLBACK: Live Calculation
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

    // Realized PnL
    const { data: closed } = await supabase
      .from('closed_trades')
      .select('pnl')
      .eq('user_id', user.id)

    const realized_pnl = (closed ?? []).reduce((s: number, t: { pnl: number }) => s + (t.pnl ?? 0), 0)

    // Use shared engine helper
    const result = calculatePortfolioSummary(positions, quotes, realized_pnl)

    // Cache the result for next time (expires in 1h, though worker updates it every 2m)
    if (isRedisReady()) {
      await getRedis()?.setex(`summary:${user.id}`, 3600, JSON.stringify(result))
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
