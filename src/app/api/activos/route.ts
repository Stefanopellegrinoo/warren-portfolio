import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'
import { normalizeError } from '@/lib/errors'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'
import { serverError } from '@/lib/api/errors'

export const dynamic = 'force-dynamic'

// Signed-in users only, limited per user; the table is readable only by the service role (S13).
const ROUTE_LIMIT = 60
const ROUTE_WINDOW_SEC = 60

export async function GET() {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error
  if (!(await rateLimit(`rl:activos:${authResult.user.id}`, ROUTE_LIMIT, ROUTE_WINDOW_SEC))) {
    return tooManyRequests(ROUTE_WINDOW_SEC)
  }
  try {
    const supabase = createServiceClient()
    
    const { data, error } = await supabase
      .from('activos')
      .select('ticker, nombre')
      .order('ticker')

    if (error) throw normalizeError(error)

    return NextResponse.json(data ?? [])
  } catch (err) {
    return serverError('API /activos', err)
  }
}