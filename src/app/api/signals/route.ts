import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'

export async function GET(req: NextRequest) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error

  const { supabase, user } = auth
  const { searchParams } = new URL(req.url)

  const ticker = searchParams.get('ticker')
  if (!ticker) return NextResponse.json({ error: 'ticker required' }, { status: 400 })

  const hours = parseInt(searchParams.get('hours') ?? '72', 10)
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('signals')
    .select('*, indicator_setups(name)')
    .eq('user_id', user.id)
    .eq('ticker', ticker)
    .gte('fired_at', since)
    .order('fired_at', { ascending: true })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data ?? [])
}
