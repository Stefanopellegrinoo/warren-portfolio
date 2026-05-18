import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

function periodToDate(period: string): Date {
  const now = Date.now()
  switch (period) {
    case '7d':
      return new Date(now - 7 * 24 * 60 * 60 * 1000)
    case '90d':
      return new Date(now - 90 * 24 * 60 * 60 * 1000)
    case '1y':
      return new Date(now - 365 * 24 * 60 * 60 * 1000)
    case '30d':
    default:
      return new Date(now - 30 * 24 * 60 * 60 * 1000)
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

    const period = searchParams.get('period') ?? '30d'
    const ticker = searchParams.get('ticker')
    const setupId = searchParams.get('setup_id')
    const type = searchParams.get('type') as 'BUY' | 'SELL' | null

    const { data: strategy } = await supabase
      .from('strategies')
      .select('id')
      .eq('id', strategyId)
      .eq('user_id', user.id)
      .single()

    if (!strategy) {
      return NextResponse.json({ error: 'Strategy not found' }, { status: 404 })
    }

    const since = periodToDate(period)

    let query = supabase
      .from('signals')
      .select('*, indicator_setups(name)')
      .eq('strategy_id', strategyId)
      .eq('user_id', user.id)
      .gte('fired_at', since.toISOString())
      .order('fired_at', { ascending: false })
      .limit(500)

    if (ticker) query = query.eq('ticker', ticker)
    if (setupId) query = query.eq('setup_id', setupId)
    if (type) query = query.eq('type', type)

    const { data, error } = await query

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const signals = (data ?? []).map((row) => ({
      id: row.id as string,
      setup_id: row.setup_id as string,
      setup_name: (row.indicator_setups as { name: string } | null)?.name ?? 'Unknown',
      ticker: row.ticker as string,
      type: row.type as 'BUY' | 'SELL',
      price: row.price as number,
      timeframe: row.timeframe as string,
      fired_at: row.fired_at as string,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    }))

    return NextResponse.json({ signals })
  } catch (err: unknown) {
    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
