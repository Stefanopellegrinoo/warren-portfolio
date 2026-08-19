import { NextResponse } from 'next/server'
import { deleteCashMovement, LinkedMovementError } from '@/lib/cash-engine'
import { UUIDSchema } from '@/lib/schemas/common'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { invalidateUserCache } from '@/lib/redis'

export const dynamic = 'force-dynamic'

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error
  const { supabase, user } = authResult

  // Validate UUID
  try {
    UUIDSchema.parse(params.id)
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Invalid movement ID', details: error.errors },
      { status: 400 }
    )
  }

  try {
    // Guard lives in the engine: transaction-linked movements are refused —
    // deleting one desyncs the ledger from transactions permanently.
    await deleteCashMovement(supabase, user.id, params.id)
  } catch (err) {
    if (err instanceof LinkedMovementError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    const message = err instanceof Error ? err.message : 'Internal error'
    const status = message === 'Movimiento no encontrado' ? 404 : 500
    return NextResponse.json({ error: message }, { status })
  }

  await invalidateUserCache(user.id)

  return NextResponse.json({ success: true })
}
