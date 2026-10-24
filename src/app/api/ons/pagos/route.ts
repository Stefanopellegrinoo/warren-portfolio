import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { loadPayments } from '@/lib/on-payments'
import { invalidateUserCache } from '@/lib/redis'
import { DateSchema } from '@/lib/schemas/common'
import { fail, parseBody } from '@/lib/test-portfolios'
import { argentinaDate } from '@/lib/utils'
import { firstIssueMessage } from '@/lib/api/validation'

export const dynamic = 'force-dynamic'

const PaymentKey = z.object({
  ticker: z.string().transform(v => v.trim().toUpperCase()).pipe(z.string().regex(/^[A-Z0-9]{1,20}$/, 'Ticker inválido')),
  pay_date: DateSchema,
  kind: z.enum(['coupon', 'amortization'], { message: 'Tipo de pago inválido' }),
})
const Correction = PaymentKey.extend({
  /** null = "No lo cobré". */
  amount: z.number({ message: 'Ingresá el monto que pagó el broker' }).positive('El monto debe ser mayor a 0').max(10_000_000, 'Monto fuera de rango').nullable(),
  note: z.string().trim().max(200, 'La nota admite hasta 200 caracteres').optional(),
}).strict()

const NOT_HELD = () => fail('Esa ON no está en tus operaciones', 404)

/** GET /api/ons/pagos: every ON payment the ledger paid (newest first) and the ones the bond calendar says are missing. */
export async function GET() {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error
  try {
    return NextResponse.json(await loadPayments(auth.supabase, auth.user.id, argentinaDate()))
  } catch (error) {
    console.error('[ONs pagos API] Failed to build the payments:', error)
    return fail('No se pudieron calcular tus pagos', 500)
  }
}

/** PUT /api/ons/pagos {ticker, pay_date, kind, amount|null, note?}: the user's word over one payment. */
export async function PUT(req: Request) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error
  const [body, bad] = await parseBody(req, Correction)
  if (bad) return bad

  // Only a bond the user holds or held: an override on any other ticker would pay a holding that is not an ON.
  const { data: held, error: heldError } = await auth.supabase.from('transactions').select('id')
    .eq('user_id', auth.user.id).eq('asset_type', 'ON').eq('ticker', body.ticker).limit(1)
  if (heldError) return dbFail(heldError)
  if (!held || held.length === 0) return NOT_HELD()

  const { error } = await auth.supabase.from('on_payment_overrides').upsert({
    user_id: auth.user.id, ticker: body.ticker, pay_date: body.pay_date, kind: body.kind,
    amount: body.amount, note: body.note || null, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,ticker,pay_date,kind' })
  if (error) return dbFail(error)
  await invalidateUserCache(auth.user.id)
  return NextResponse.json({ ok: true })
}

/** DELETE /api/ons/pagos?ticker=&pay_date=&kind=: drops the correction, the payment is automatic again. */
export async function DELETE(req: Request) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error
  const parsed = PaymentKey.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return fail(firstIssueMessage(parsed.error), 400)
  const key = parsed.data

  const { data, error } = await auth.supabase.from('on_payment_overrides').delete()
    .eq('user_id', auth.user.id).eq('ticker', key.ticker).eq('pay_date', key.pay_date).eq('kind', key.kind).select('id')
  if (error) return dbFail(error)
  if (!data || data.length === 0) return fail('No había una corrección para ese pago', 404)
  await invalidateUserCache(auth.user.id)
  return new NextResponse(null, { status: 204 })
}

function dbFail(error: { code?: string; message?: string }) {
  console.error('[ONs pagos API] database error:', error.code, error.message)
  return fail('No se pudo completar la operación', 500)
}
