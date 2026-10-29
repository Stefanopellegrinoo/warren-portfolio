import { NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { serverError } from '@/lib/api/errors'
import { validateRequest, validationErrorResponse } from '@/lib/api/validation'
import { DepositDatesSchema } from '@/lib/schemas/cash'
import { checkRedatePlan, loadDepositProposal } from '@/lib/deposit-dates'
import { invalidateUserCache } from '@/lib/redis'
import { argentinaDate } from '@/lib/utils'

const CHANGED = 'Tus movimientos cambiaron desde que se armó la propuesta: revisala de nuevo.'

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

/**
 * Saves the dates the user confirmed (S3): one call to redate_deposits (055), all or nothing.
 * The plan must be a fresh proposal, dates aside — checked here before anything is written, so
 * a plan made before another write, or any other split, is refused.
 */
export async function POST(request: Request) {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error
  const { supabase, user } = authResult

  try {
    const body = await validateRequest(DepositDatesSchema, request)
    const today = argentinaDate()
    const check = checkRedatePlan(body.deposits, await loadDepositProposal(supabase, user.id, today), today)
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status })

    const { data, error } = await supabase.rpc('redate_deposits', { p_changes: check.changes })
    // The function refuses with its own message when a deposit moved under it: nothing was written.
    if (error) {
      if (String(error.message ?? '').startsWith('redate_deposits:')) return NextResponse.json({ error: CHANGED }, { status: 409 })
      throw error
    }

    // The movements changed: drop every cache derived from them.
    await invalidateUserCache(user.id)
    return NextResponse.json({ saved: data })
  } catch (error: any) {
    if (error?.status === 400) return validationErrorResponse(error)
    return serverError('API /cash/deposit-dates', error)
  }
}

