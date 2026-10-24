import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { DateSchema } from '@/lib/schemas/common'
import { getFxRate } from '@/lib/fx-rates'
import { createServiceClient } from '@/lib/supabase-server'
import { serverError } from '@/lib/api/errors'
import { firstIssueMessage } from '@/lib/api/validation'

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
  if (!date.success) return NextResponse.json({ error: firstIssueMessage(date.error) }, { status: 400 })

  try {
    // fx_rates is readable only by the service role (odd/tasks/security-hardening.md S12).
    const market = createServiceClient()
    const [mep, ccl] = await Promise.all([getFxRate(market, date.data, 'mep'), getFxRate(market, date.data, 'ccl')])
    if (!mep && !ccl) return NextResponse.json({ error: 'No hay cotización del dólar para esa fecha' }, { status: 404 })
    return NextResponse.json({ mep, ccl })
  } catch (err) {
    return serverError('fx', err)
  }
}
