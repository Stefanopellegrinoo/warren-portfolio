import { NextResponse } from 'next/server'
import { rebuildCashBalance } from '@/lib/cash-engine'
import { UUIDSchema } from '@/lib/schemas/common'
import { requireUser, isAuthFailure } from '@/lib/api-auth'

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

  const { error } = await supabase
    .from('cash_movements')
    .delete()
    .eq('id', params.id)
    .eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Rebuild balance after deletion
  await rebuildCashBalance(supabase, user.id)

  return NextResponse.json({ success: true })
}
