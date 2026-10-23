import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { serverError } from '@/lib/api/errors'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error

  const { supabase, user } = auth
  const alertId = params.id

  // Verify the alert belongs to the current user before returning history
  const { data: alert, error: alertError } = await supabase
    .from('alerts')
    .select('id')
    .eq('id', alertId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (alertError) return serverError('API /alerts/[id]/history', alertError)
  if (!alert) return NextResponse.json({ error: 'Alert not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('alert_history')
    .select('id, channel, status, error, sent_at, signal_id')
    .eq('alert_id', alertId)
    .order('sent_at', { ascending: false })
    .limit(20)

  if (error) return serverError('API /alerts/[id]/history', error)

  return NextResponse.json({ history: data ?? [] })
}
