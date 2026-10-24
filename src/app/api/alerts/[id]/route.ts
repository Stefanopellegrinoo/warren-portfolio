import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { z } from 'zod'
import { serverError } from '@/lib/api/errors'
import { firstIssueMessage, INVALID_JSON } from '@/lib/api/validation'

const updateSchema = z.object({
  active: z.boolean({ message: 'Indicá si la alerta queda activa' }).optional(),
  channels: z.array(z.enum(['telegram', 'email'], { message: 'Elegí Telegram o email' })).min(1, 'Elegí al menos un canal de aviso: Telegram o email').optional(),
})

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
    return NextResponse.json({ error: INVALID_JSON }, { status: 400 })
  }

  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: firstIssueMessage(parsed.error) }, { status: 400 })
  }

  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'No hay cambios para guardar' }, { status: 400 })
  }

  const { data, error, count } = await supabase
    .from('alerts')
    .update(parsed.data)
    .eq('id', alertId)
    .eq('user_id', user.id)
    .select()

  if (error) return serverError('API /alerts/[id]', error)

  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'No encontramos esa alerta' }, { status: 404 })
  }

  return NextResponse.json({ alert: data[0] })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error

  const { supabase, user } = auth
  const alertId = params.id

  const { error } = await supabase
    .from('alerts')
    .delete()
    .eq('id', alertId)
    .eq('user_id', user.id)

  if (error) return serverError('API /alerts/[id]', error)

  return new NextResponse(null, { status: 204 })
}
