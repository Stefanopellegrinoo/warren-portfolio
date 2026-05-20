import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'

export async function GET(_req: NextRequest) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error

  const { supabase, user } = auth

  const { data, error } = await supabase
    .from('price_alerts')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ alerts: data ?? [] })
}

export async function POST(req: NextRequest) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error

  const { supabase, user } = auth

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { ticker, type, operator, value, name } = (body ?? {}) as Record<string, unknown>

  if (!ticker || !type || !operator || value === undefined || value === null || !name) {
    return NextResponse.json(
      { error: 'Missing required fields: ticker, type, operator, value, name' },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from('price_alerts')
    .insert({
      user_id: user.id,
      ticker,
      type,
      operator,
      value,
      name,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ alert: data }, { status: 201 })
}
