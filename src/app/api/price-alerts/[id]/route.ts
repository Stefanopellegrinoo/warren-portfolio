import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { invalidateUserCache } from '@/lib/redis'

const VALID_OPERATORS = ['crosses_above', 'crosses_below'] as const

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error

  const { supabase, user } = auth
  const alertId = params.id

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { name, operator, value, channel } = (body ?? {}) as Record<string, unknown>

  if (operator !== undefined && !VALID_OPERATORS.includes(operator as typeof VALID_OPERATORS[number])) {
    return NextResponse.json(
      { error: `operator must be one of: ${VALID_OPERATORS.join(', ')}` },
      { status: 400 }
    )
  }

  if (value !== undefined && (typeof value !== 'number' || !isFinite(value))) {
    return NextResponse.json({ error: 'value must be a finite number' }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}
  if (name !== undefined) patch.name = name
  if (operator !== undefined) patch.operator = operator
  if (value !== undefined) patch.value = value
  if (channel !== undefined) patch.channel = channel

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('price_alerts')
    .update(patch)
    .eq('id', alertId)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Alert not found' }, { status: 404 })
  }

  await invalidateUserCache(user.id)

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
    return NextResponse.json({ error: 'Alert not found' }, { status: 403 })
  }

  const { error } = await supabase
    .from('price_alerts')
    .delete()
    .eq('id', alertId)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return new NextResponse(null, { status: 204 })
}
