import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { serverError } from '@/lib/api/errors'
import { bumpAlertsVersion } from '@/lib/redis'
import { tooManyRequests } from '@/lib/rate-limit'
import { parseAlertCreate } from '@/lib/chart/alert-condition'
import { CHECK_VIOLATION, INVALID_CONDITION, WRITE_WINDOW_SEC, readAlertBody, writeAllowed } from './write'

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

  if (!(await writeAllowed(user.id))) return tooManyRequests(WRITE_WINDOW_SEC)

  const read = await readAlertBody(req)
  if ('error' in read) return read.error
  const parsed = parseAlertCreate(read.body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { ticker, type, operator, value, name, source, target, timeframe, periods, color } = parsed.data

  // Today's columns as before; the new ones only when they differ from the defaults of 052, so an
  // alert like the ones before is written exactly as it was.
  const { data, error } = await supabase
    .from('price_alerts')
    .insert({
      user_id: user.id,
      ticker,
      type,
      operator,
      value,
      name,
      ...(source !== 'price' && { source }),
      ...(target !== 'value' && { target }),
      ...(timeframe && { timeframe, periods }),
      ...(color && { color }),
    })
    .select()
    .single()

  if (error?.code === CHECK_VIOLATION) return NextResponse.json({ error: INVALID_CONDITION }, { status: 400 })
  if (error) return serverError('API /price-alerts', error)
  // The worker reads the active alerts again (odd/tasks/supabase-efficiency.md S4).
  await bumpAlertsVersion()

  return NextResponse.json({ alert: data }, { status: 201 })
}
