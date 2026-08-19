import { NextResponse } from 'next/server'
import { processCashMovement } from '@/lib/cash-engine'
import { addRefreshSummaryJob } from '@/lib/queue'
import { validateRequest, validationErrorResponse } from '@/lib/api/validation'
import { CashMovementSchema } from '@/lib/schemas/cash'
import { normalizeError } from '@/lib/errors'
import { requireUser, isAuthFailure } from '@/lib/api-auth'

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

    // Handle other errors
    const err = normalizeError(error)
    return NextResponse.json(
      { error: err.message || 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function GET() {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error
  const { supabase, user } = authResult

  const { data: balance } = await supabase
    .from('cash_balance')
    .select('*')
    .eq('user_id', user.id)
    .single()

  return NextResponse.json({ balance: balance ?? null })
}
