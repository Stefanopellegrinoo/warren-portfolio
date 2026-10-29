import { NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { serverError } from '@/lib/api/errors'
import { loadDepositProposal } from '@/lib/deposit-dates'

export const dynamic = 'force-dynamic'

/**
 * The deposits recorded after the purchases they paid, and the earlier days each one funds:
 * what the user reviews before anything is saved (odd/tasks/deposit-dates.md S2). Reads only.
 */
export async function GET() {
  try {
    const authResult = await requireUser()
    if (isAuthFailure(authResult)) return authResult.error
    const { supabase, user } = authResult
    return NextResponse.json(await loadDepositProposal(supabase, user.id))
  } catch (err) {
    return serverError('API /cash/deposit-dates', err)
  }
}
