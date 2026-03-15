import { NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'

export async function GET() {
  const supabase = createServerClientInstance()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error, count } = await supabase
    .from('closed_trades')
    .select('*', { count: 'exact' })
    .eq('user_id', user.id)
    .order('close_date', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const totalPnl = (data ?? []).reduce((s, t) => s + (t.pnl ?? 0), 0)
  const totalInvested = (data ?? []).reduce((s, t) => s + (t.invested ?? 0), 0)

  return NextResponse.json({ data, count, totalPnl, totalInvested })
}
