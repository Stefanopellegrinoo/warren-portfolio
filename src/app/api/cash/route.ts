import { NextResponse } from 'next/server'
import { processCashMovement } from '@/lib/cash-engine'
import { addRefreshSummaryJob } from '@/lib/queue'
import { validateRequest, validationErrorResponse } from '@/lib/api/validation'
import { CashMovementSchema } from '@/lib/schemas/cash'
import { normalizeError } from '@/lib/errors'
import { serverError } from '@/lib/api/errors'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { getFullPortfolio } from '@/lib/portfolio-engine'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error
  const { supabase, user } = authResult

  try {
    // Validate request body
    const body = await validateRequest(CashMovementSchema, request)

    // Process the movement
    const result = await processCashMovement(supabase, user.id, body)

    // Enqueue an explicit summary refresh at the API boundary as well
    try {
      await addRefreshSummaryJob(user.id)
    } catch (err) {
      console.warn('[API /cash] Failed to enqueue summary refresh:', err)
    }

    return NextResponse.json(result)
  } catch (error: any) {
    // Handle validation errors
    if (error.status === 400) {
      return validationErrorResponse(error)
    }

    return serverError('API /cash', error)
  }
}

export async function GET() {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error
  const { supabase, user } = authResult

  // The cash from the ledger core: movements plus the automatic ON payments (S4).
  try {
    const { cashBalance } = await getFullPortfolio(supabase, user.id)
    return NextResponse.json({ balance: { user_id: user.id, balance: cashBalance } })
  } catch (err) {
    return serverError('API /cash', normalizeError(err))
  }
}
