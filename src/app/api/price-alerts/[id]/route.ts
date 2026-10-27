import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { bumpAlertsVersion, invalidateUserCache } from '@/lib/redis'
import { serverError } from '@/lib/api/errors'
import { tooManyRequests } from '@/lib/rate-limit'
import { parseAlertUpdate } from '@/lib/chart/alert-condition'
import { CHECK_VIOLATION, INVALID_CONDITION, WRITE_WINDOW_SEC, readAlertBody, writeAllowed } from '../write'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error

  const { supabase, user } = auth
  const alertId = params.id

  if (!(await writeAllowed(user.id))) return tooManyRequests(WRITE_WINDOW_SEC)

  const read = await readAlertBody(req)
  if ('error' in read) return read.error
  // Only re-arming is allowed: the worker owns 'triggered' and 'unavailable'.
  const parsed = parseAlertUpdate(read.body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const patch = parsed.data

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No hay cambios para guardar' }, { status: 400 })
  }

  let query = supabase
    .from('price_alerts')
    .update(patch)
    .eq('id', alertId)
    .eq('user_id', user.id)
  // A value alone is a dragged line from a client that predates 052: only an alert on the price against
  // a value has that line, so on any other it would turn "RSI crosses 70" into a price.
  if (patch.value !== undefined && patch.source === undefined) {
    query = query.eq('source', 'price').eq('target', 'value')
  }
  const { data, error } = await query.select().single()

  if (error?.code === CHECK_VIOLATION) return NextResponse.json({ error: INVALID_CONDITION }, { status: 400 })
  if (error || !data) {
    return NextResponse.json({ error: 'No encontramos esa alerta' }, { status: 404 })
  }

  await invalidateUserCache(user.id)
  await bumpAlertsVersion()

  return NextResponse.json({ alert: data })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error

  const { supabase, user } = auth
  const alertId = params.id

  // Verify ownership before deleting
  const { data: existing, error: fetchError } = await supabase
    .from('price_alerts')
    .select('id')
    .eq('id', alertId)
    .eq('user_id', user.id)
    .single()

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'No encontramos esa alerta' }, { status: 403 })
  }

  const { error } = await supabase
    .from('price_alerts')
    .delete()
    .eq('id', alertId)
    .eq('user_id', user.id)

  if (error) return serverError('API /price-alerts/[id]', error)
  await bumpAlertsVersion()

  return new NextResponse(null, { status: 204 })
}
