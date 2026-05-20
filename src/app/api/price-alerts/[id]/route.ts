import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error

  const { supabase, user } = auth
  const alertId = params.id

  // Verify ownership before deleting
  const { data: existing, error: fetchError } = await supabase
    .from('price_alerts')
    .select('id')
    .eq('id', alertId)
    .eq('user_id', user.id)
    .single()

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Alert not found' }, { status: 403 })
  }

  const { error } = await supabase
    .from('price_alerts')
    .delete()
    .eq('id', alertId)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return new NextResponse(null, { status: 204 })
}
