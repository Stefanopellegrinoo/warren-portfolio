import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireUser()
    if (isAuthFailure(auth)) return auth.error
    const { supabase, user } = auth

    const strategyId = params.id

    const { data: strategy } = await supabase
      .from('strategies')
      .select('id, name')
      .eq('id', strategyId)
      .eq('user_id', user.id)
      .single()

    if (!strategy) {
      return NextResponse.json({ error: 'Strategy not found' }, { status: 404 })
    }

    const [{ data: setups }, { data: perf }, { data: openTrades }] = await Promise.all([
      supabase
        .from('indicator_setups')
        .select('id, name, active')
        .eq('strategy_id', strategyId)
        .eq('user_id', user.id),
      supabase
        .from('setup_performance')
        .select('*')
        .eq('strategy_id', strategyId)
        .eq('user_id', user.id),
      supabase
        .from('paper_trades')
        .select('setup_id')
        .eq('strategy_id', strategyId)
        .eq('user_id', user.id)
        .eq('status', 'OPEN'),
    ])

    const perfRows = perf ?? []
    const openTradeRows = openTrades ?? []

    const aggregatedSetups = (setups ?? []).map((setup) => {
      const rows = perfRows.filter((r) => r.setup_id === setup.id)
      const openCount = openTradeRows.filter((t) => t.setup_id === setup.id).length
      const tickers = [...new Set(rows.map((r) => r.ticker as string))]

      const totalTrades = rows.reduce((sum, r) => sum + (r.total_trades as number), 0)
      const profitableTrades = rows.reduce((sum, r) => sum + (r.profitable_trades as number), 0)

      const hitRate = totalTrades > 0 ? profitableTrades / totalTrades : null

      const rowsWithReturn = rows.filter((r) => r.avg_return_pct != null)
      const totalTradesWithReturn = rowsWithReturn.reduce((s, r) => s + (r.total_trades as number), 0)
      const avgReturnPct =
        totalTradesWithReturn > 0
          ? rowsWithReturn.reduce((sum, r) => {
              const w = (r.total_trades as number) / totalTradesWithReturn
              return sum + (r.avg_return_pct as number) * w
            }, 0)
          : null

      const rowsWithDuration = rows.filter((r) => r.avg_duration_days != null)
      const totalTradesWithDuration = rowsWithDuration.reduce((s, r) => s + (r.total_trades as number), 0)
      const avgDurationDays =
        totalTradesWithDuration > 0
          ? rowsWithDuration.reduce((sum, r) => {
              const w = (r.total_trades as number) / totalTradesWithDuration
              return sum + (r.avg_duration_days as number) * w
            }, 0)
          : null

      return {
        setup_id: setup.id as string,
        setup_name: setup.name as string,
        active: setup.active as boolean,
        total_trades: totalTrades,
        profitable_trades: profitableTrades,
        hit_rate: hitRate,
        avg_return_pct: avgReturnPct,
        avg_duration_days: avgDurationDays,
        open_trades: openCount,
        tickers,
      }
    })

    aggregatedSetups.sort((a, b) => {
      if (a.hit_rate === null && b.hit_rate === null) return b.total_trades - a.total_trades
      if (a.hit_rate === null) return 1
      if (b.hit_rate === null) return -1
      if (b.hit_rate !== a.hit_rate) return b.hit_rate - a.hit_rate
      return b.total_trades - a.total_trades
    })

    const eligible = aggregatedSetups.filter(
      (s) => s.hit_rate !== null && s.total_trades >= 3
    )
    const bestSetupId =
      eligible.length > 0
        ? eligible.reduce((best, s) => (s.hit_rate! > best.hit_rate! ? s : best)).setup_id
        : null

    return NextResponse.json({ setups: aggregatedSetups, best_setup_id: bestSetupId })
  } catch (err: unknown) {
    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
