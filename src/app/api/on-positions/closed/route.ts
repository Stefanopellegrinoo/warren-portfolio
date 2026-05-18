import { NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createServerClientInstance()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: closedTrades, error } = await supabase
    .from('on_closed_trades')
    .select('*')
    .eq('user_id', user.id)
    .order('closed_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ closedTrades: closedTrades ?? [] })
}
