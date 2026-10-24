import { NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'
import { sendPushToUser } from '@/lib/push'
import { PUSH_NOT_CONFIGURED } from '@/lib/schemas/push'

// A test is a tap away: a few per minute is plenty and keeps the push services happy.
const LIMIT = 5
const WINDOW_SEC = 60

const FAILURES: Record<string, { status: number; error: string }> = {
  'no devices': { status: 409, error: 'Este dispositivo todavía no tiene los avisos activados.' },
  'push not configured': { status: 503, error: PUSH_NOT_CONFIGURED },
}

// Sends a test notification to every device of the signed-in user.
export async function POST() {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error
  const { supabase, user } = auth

  if (!(await rateLimit(`rl:push-test:${user.id}`, LIMIT, WINDOW_SEC))) return tooManyRequests(WINDOW_SEC)

  const result = await sendPushToUser(supabase, user.id, {
    title: 'Warren', body: 'Las notificaciones funcionan en este dispositivo.', url: '/strategies?tab=alertas', tag: 'push-test',
  })
  if (result.ok) return NextResponse.json({ sent: result.sent })
  const failure = FAILURES[result.error] ?? { status: 502, error: 'No se pudo enviar la prueba. Probá de nuevo en un rato.' }
  return NextResponse.json({ error: failure.error }, { status: failure.status })
}
