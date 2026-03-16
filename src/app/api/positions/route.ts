import { NextRequest, NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'
import { fetchQuotes } from '@/lib/yahoo-finance'
import { calculatePortfolioSummary } from '@/lib/portfolio-engine'
import { getRedis, ensureRedisConnected } from '@/lib/redis'
import type { Position } from '@/types'

export async function GET(req: NextRequest) {
  try {
    const supabase = createServerClientInstance()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // ENSURE REDIS IS CONNECTED before any reads
    const redisOk = await ensureRedisConnected()

    // 1. TRY REDIS CACHE (Sub-10ms path)
    if (redisOk) {
      const redis = getRedis()
      const cached = await redis?.get(`summary:${user.id}`)
      if (cached) {
        console.log(`[Cache Hit] Serving summary for ${user.id} from Redis`)
        const data = JSON.parse(cached)
        const lr = await redis?.get('system:last-refresh')
        return NextResponse.json({ ...data, lastRefresh: lr || null })
      }
    }

    // 2. FALLBACK: Build from individual LKP prices in Redis
    const { data: positions, error } = await supabase
      .from('positions')
      .select('*')
      .eq('user_id', user.id)
      .order('total_invested', { ascending: false })

    if (error) throw error
    if (!positions?.length) return NextResponse.json({ positions: [], summary: null, lastRefresh: null })

    // Get last refresh timestamp
    let lastRefresh: string | null = null
    if (redisOk) {
      const lr = await getRedis()?.get('system:last-refresh')
      if (lr) lastRefresh = lr
    }

    // Fetch prices from LKP (Redis persistent storage)
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

    // Cache the result for next time
    if (redisOk) {
      await getRedis()?.setex(`summary:${user.id}`, 600, JSON.stringify(result))
    }

    return NextResponse.json({ ...result, lastRefresh })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
