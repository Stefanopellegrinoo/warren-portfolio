import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { DateSchema } from '@/lib/schemas/common'
import { getFxRate } from '@/lib/fx-rates'

export const dynamic = 'force-dynamic'

/**
 * GET /api/fx?date=YYYY-MM-DD → the reference MEP and CCL of that date, each
 * with the date it actually comes from (the previous day with a rate on
 * weekends and holidays). A rate with no history yet is null; 404 when neither
 * exists.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error

  const date = DateSchema.safeParse(req.nextUrl.searchParams.get('date'))
  if (!date.success) return NextResponse.json({ error: 'date must be a valid YYYY-MM-DD' }, { status: 400 })

  try {
    const [mep, ccl] = await Promise.all([getFxRate(auth.supabase, date.data, 'mep'), getFxRate(auth.supabase, date.data, 'ccl')])
    if (!mep && !ccl) return NextResponse.json({ error: 'No hay cotización para esa fecha.' }, { status: 404 })
    return NextResponse.json({ mep, ccl })
  } catch (err) {
    console.error('[fx] read failed:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
