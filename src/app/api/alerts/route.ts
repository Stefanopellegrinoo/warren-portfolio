import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { z } from 'zod'
import { serverError } from '@/lib/api/errors'
import { firstIssueMessage, INVALID_JSON } from '@/lib/api/validation'

const createSchema = z.object({
  ticker: z.string({ message: 'Ingresá el ticker' }).min(1, 'Ingresá el ticker').max(20, 'El ticker puede tener hasta 20 caracteres'),
  setup_id: z.string({ message: 'Elegí un setup' }).uuid('Elegí un setup'),
  channels: z.array(z.enum(['telegram', 'email'], { message: 'Elegí Telegram o email' })).min(1, 'Elegí al menos un canal de aviso: Telegram o email'),
})

export async function GET(req: NextRequest) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error

  const { supabase, user } = auth
  const { searchParams } = new URL(req.url)
  const setupId = searchParams.get('setup_id')

  let query = supabase
    .from('alerts')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (setupId) {
    query = query.eq('setup_id', setupId)
  }

  const { data, error } = await query

  if (error) return serverError('API /alerts', error)

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

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: firstIssueMessage(parsed.error) }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('alerts')
    .insert({ ...parsed.data, user_id: user.id })
    .select()
    .single()

  if (error) return serverError('API /alerts', error)

  return NextResponse.json({ alert: data }, { status: 201 })
}
