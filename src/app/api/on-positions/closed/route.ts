import { NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { getFullPortfolio } from '@/lib/portfolio-engine'

export const dynamic = 'force-dynamic'

/** The user's realized ON sales from the ledger core, newest first. */
export async function GET() {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error
  const { supabase, user } = authResult

  try {
    const { onClosedTrades } = await getFullPortfolio(supabase, user.id)
    return NextResponse.json({ closedTrades: [...onClosedTrades].reverse() })
  } catch (err) {
    console.error('[API] ON closed trades error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
