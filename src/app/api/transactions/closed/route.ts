import { NextRequest, NextResponse } from 'next/server'
import { validateQueryParams, validationErrorResponse } from '@/lib/api/validation'
import { TransactionQuerySchema } from '@/lib/schemas/transaction'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { getFullPortfolio } from '@/lib/portfolio-engine'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const authResult = await requireUser()
    if (isAuthFailure(authResult)) return authResult.error
    const { supabase, user } = authResult

    // Validate query params
    const { ticker, limit, offset } = validateQueryParams(TransactionQuerySchema, req.url)

    // The realized stock sales from the ledger core (never the stored closed_trades), newest first.
    const { stockClosedTrades } = await getFullPortfolio(supabase, user.id)
    const all = [...stockClosedTrades].reverse().filter(t => !ticker || t.ticker === ticker.toUpperCase())
    const data = all.slice(offset, offset + limit)
    const count = all.length

    return NextResponse.json({ data, count })
  } catch (err: any) {
    // Handle validation errors
    if (err.status === 400) {
      return validationErrorResponse(err)
    }

    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
