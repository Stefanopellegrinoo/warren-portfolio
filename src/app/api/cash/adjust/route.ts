import { NextResponse } from 'next/server'
import { adjustCashBalance } from '@/lib/cash-engine'
import { validateRequest, validationErrorResponse } from '@/lib/api/validation'
import { CashAdjustSchema } from '@/lib/schemas/cash'
import { invalidateUserCache } from '@/lib/redis'
import { normalizeError } from '@/lib/errors'
import { requireUser, isAuthFailure } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/cash/adjust — reconcile the ledger to a real cash balance.
 *
 * Body: { balance, date, description? }
 *
 * Imported histories contain buys but not the deposits that funded them, so the
 * replayed balance is legitimately negative. Rather than inventing a deposit
 * history nobody remembers, the user states the balance they actually have and
 * this writes the single movement that closes the gap.
 *
 * Date it at the start of the history when reconciling an import: movements
 * before the first snapshot are excluded from the flow-adjusted drawdown, so an
 * opening balance does not distort the metric.
 */
export async function POST(request: Request) {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error
  const { supabase, user } = authResult

  try {
    const body = await validateRequest(CashAdjustSchema, request)

    const result = await adjustCashBalance(
      supabase,
      user.id,
      body.balance,
      body.date,
      body.description
    )

    // rebuildCashBalance clears the summary and cash keys; this also drops the
    // statistics and history caches, which the new movement invalidates too.
    await invalidateUserCache(user.id)

    return NextResponse.json({
      adjusted: result.movement !== null,
      delta: result.delta,
      movement: result.movement,
      balance: result.balance,
    })
  } catch (error: any) {
    if (error?.status === 400) {
      return validationErrorResponse(error)
    }
    const normalized = normalizeError(error)
    console.error('[API /cash/adjust] Failed:', normalized)
    return NextResponse.json({ error: normalized.message }, { status: 500 })
  }
}
