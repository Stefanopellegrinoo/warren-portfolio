import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

function periodToDate(period: string): Date {
  const now = Date.now()
  switch (period) {
    case '7d':
      return new Date(now - 7 * 24 * 60 * 60 * 1000)
    case '30d':
      return new Date(now - 30 * 24 * 60 * 60 * 1000)
    case '1y':
      return new Date(now - 365 * 24 * 60 * 60 * 1000)
    case '90d':
    default:
      return new Date(now - 90 * 24 * 60 * 60 * 1000)
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireUser()
    if (isAuthFailure(auth)) return auth.error
    const { supabase, user } = auth

    const strategyId = params.id
    const { searchParams } = new URL(req.url)

    const setupId = searchParams.get('setup_id')
    const ticker = searchParams.get('ticker')
    const status = (searchParams.get('status') ?? 'CLOSED') as 'OPEN' | 'CLOSED'
    const period = searchParams.get('period') ?? '90d'

    const { data: strategy } = await supabase
      .from('strategies')
      .select('id')
      .eq('id', strategyId)
      .eq('user_id', user.id)
      .single()

    if (!strategy) {
      return NextResponse.json({ error: 'Strategy not found' }, { status: 404 })
    }

    let query = supabase
      .from('paper_trades')
      .select('*, indicator_setups(name)')
      .eq('strategy_id', strategyId)
      .eq('user_id', user.id)
      .eq('status', status)
      .order('open_at', { ascending: false })
      .limit(200)

    if (status === 'CLOSED') {
      const since = periodToDate(period)
      query = query.gte('close_at', since.toISOString())
    }

    if (setupId) query = query.eq('setup_id', setupId)
    if (ticker) query = query.eq('ticker', ticker)

    const { data, error } = await query

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const trades = (data ?? []).map((row) => ({
      id: row.id as string,
      setup_id: row.setup_id as string,
      setup_name: (row.indicator_setups as { name: string } | null)?.name ?? 'Unknown',
      ticker: row.ticker as string,
      status: row.status as 'OPEN' | 'CLOSED',
      open_price: row.open_price as number,
      close_price: (row.close_price as number | null) ?? null,
      open_at: row.open_at as string,
      close_at: (row.close_at as string | null) ?? null,
      close_reason: (row.close_reason as 'SIGNAL' | 'STOP_LOSS' | 'TAKE_PROFIT' | null) ?? null,
      pnl_pct: (row.pnl_pct as number | null) ?? null,
    }))

    return NextResponse.json({ trades })
  } catch (err: unknown) {
    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
