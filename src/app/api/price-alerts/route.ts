import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { serverError } from '@/lib/api/errors'
import { INVALID_JSON } from '@/lib/api/validation'

export async function GET(req: NextRequest) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error

  const { supabase, user } = auth
  // Optional: the chart asks for one ticker; the strategies tab lists them all
  const ticker = req.nextUrl.searchParams.get('ticker')

  let query = supabase
    .from('price_alerts')
    .select('*')
    .eq('user_id', user.id)
  if (ticker) query = query.eq('ticker', ticker)

  const { data, error } = await query.order('created_at', { ascending: false })

  if (error) return serverError('API /price-alerts', error)

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
    return NextResponse.json({ error: INVALID_JSON }, { status: 400 })
  }

  const { ticker, type, operator, value, name } = (body ?? {}) as Record<string, unknown>

  if (!ticker || !type || !operator || value === undefined || value === null || !name) {
    return NextResponse.json(
      { error: 'Completá el ticker, el tipo, la condición, el valor y el nombre de la alerta' },
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

  if (error) return serverError('API /price-alerts', error)

  return NextResponse.json({ alert: data }, { status: 201 })
}
