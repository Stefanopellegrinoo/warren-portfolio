import { NextRequest, NextResponse } from 'next/server'
import type { Cashflow } from '@/types'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { invalidateUserCache } from '@/lib/redis'
import { serverError } from '@/lib/api/errors'
import { argentinaDate } from '@/lib/utils'

const ALLOWED_CATEGORIES = [
  'Alquiler', 'Servicios', 'Supermercado', 'Transporte', 'Salud',
  'Educación', 'Entretenimiento', 'Restaurantes', 'Ropa', 'Tecnología',
  'Impuestos', 'Seguros', 'Suscripciones', 'Honorarios', 'Inversiones',
  'Retiro', 'Depósito', 'Gastos Fijos', 'Otro'
]

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error
  const { supabase, user } = authResult

  const { data, error, count } = await supabase
    .from('cashflow')
    .select('*', { count: 'exact' })
    .eq('user_id', user.id)
    .order('date', { ascending: false })

  if (error) return serverError('API /cashflow', error)

  const cashflowData = (data as Cashflow[] | null) ?? []
  const pending = cashflowData.filter((c: Cashflow) => c.status === 'PENDIENTE')
  const totalPending = pending.reduce((s: number, c: Cashflow) => s + (c.amount_usd ?? 0), 0)
  // Due dates are YYYY-MM-DD: due today is not overdue until the day is over in Argentina.
  const today = argentinaDate()
  const overdue = pending.filter((c: Cashflow) => c.date < today)

  return NextResponse.json({ data, count, totalPending, overdueCount: overdue.length })
}

export async function POST(req: NextRequest) {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error
  const { supabase, user } = authResult

  const body = await req.json()

  // Input validation
  const { date, category, description, amount_usd, status } = body

  if (!date || typeof date !== 'string') {
    return NextResponse.json({ error: 'Ingresá una fecha' }, { status: 400 })
  }
  if (!category || !ALLOWED_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: 'Elegí una categoría de la lista' }, { status: 400 })
  }
  if (typeof amount_usd !== 'number' || amount_usd <= 0) {
    return NextResponse.json({ error: 'El monto tiene que ser mayor a 0' }, { status: 400 })
  }
  if (status && !['PAGADO', 'PENDIENTE'].includes(status)) {
    return NextResponse.json({ error: 'Elegí un estado: pagado o pendiente' }, { status: 400 })
  }

  // Only pass whitelisted fields
  const { data, error } = await supabase
    .from('cashflow')
    .insert({
      user_id: user.id,
      date,
      category,
      description: typeof description === 'string' ? description.trim().slice(0, 500) : null,
      amount_usd,
      status: status || 'PENDIENTE',
    })
    .select()
    .single()

  if (error) return serverError('API /cashflow', error)
  await invalidateUserCache(user.id)
  return NextResponse.json(data, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error
  const { supabase, user } = authResult

  const body = await req.json()
  const { id, status } = body

  if (!id) return NextResponse.json({ error: 'Falta el identificador del gasto' }, { status: 400 })

  // Only allow status updates via PATCH
  if (status && !['PAGADO', 'PENDIENTE'].includes(status)) {
    return NextResponse.json({ error: 'Elegí un estado: pagado o pendiente' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('cashflow')
    .update({ status })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return serverError('API /cashflow', error)
  if (!data) return NextResponse.json({ error: 'No encontramos ese gasto' }, { status: 404 })
  await invalidateUserCache(user.id)
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error
  const { supabase, user } = authResult

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'Falta el identificador del gasto' }, { status: 400 })

  const { error } = await supabase
    .from('cashflow')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return serverError('API /cashflow', error)
  await invalidateUserCache(user.id)
  return NextResponse.json({ ok: true })
}
