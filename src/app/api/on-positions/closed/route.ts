import { NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error
  const { supabase, user } = authResult

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
