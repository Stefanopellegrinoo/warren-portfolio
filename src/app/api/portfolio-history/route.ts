import { NextRequest, NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'
import { fetchQuotes } from '@/lib/portfolio-engine'
import type { Position } from '@/types'

// GET: return all snapshots for chart
export async function GET(req: NextRequest) {
  const supabase = createServerClientInstance()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const days = parseInt(searchParams.get('days') ?? '90')

  const from = new Date()
  from.setDate(from.getDate() - days)

  const { data, error } = await supabase
    .from('portfolio_snapshots')
    .select('*')
    .eq('user_id', user.id)
    .gte('snapshot_date', from.toISOString().split('T')[0])
    .order('snapshot_date', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

// POST: take a snapshot of current portfolio value (call daily via cron or manually)
export async function POST(req: NextRequest) {
  const supabase = createServerClientInstance()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: positions } = await supabase
    .from('positions')
    .select('*')
    .eq('user_id', user.id)

  if (!positions?.length) return NextResponse.json({ error: 'No positions' }, { status: 400 })

  const tickers = positions.map((p: Position) => p.ticker)
  const quotes = await fetchQuotes(tickers)

  const total_value = positions.reduce((s: number, p: Position) => {
    const price = quotes.get(p.ticker) ?? p.avg_cost
    return s + price * p.quantity
  }, 0)

  const total_invested = positions.reduce((s: number, p: Position) => s + p.total_invested, 0)
  const pnl = total_value - total_invested
  const pnl_pct = total_invested > 0 ? pnl / total_invested : 0

  const today = new Date().toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('portfolio_snapshots')
    .upsert({
      user_id: user.id,
      snapshot_date: today,
      total_value,
      total_invested,
      pnl,
      pnl_pct,
    }, { onConflict: 'user_id,snapshot_date' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
