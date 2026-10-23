import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'
import { normalizeError } from '@/lib/errors'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

// Signed-in users only, limited per user; the table is readable only by the service role (S13).
const ROUTE_LIMIT = 60
const ROUTE_WINDOW_SEC = 60

export async function GET() {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error
  if (!(await rateLimit(`rl:cedears:${authResult.user.id}`, ROUTE_LIMIT, ROUTE_WINDOW_SEC))) {
    return tooManyRequests(ROUTE_WINDOW_SEC)
  }
  try {
    const supabase = createServiceClient()
    
    const { data, error } = await supabase
      .from('cedears')
      .select('ticker, ratio, activos!inner(nombre)')
      .order('ticker')

    if (error) throw normalizeError(error)

    // Transformar para que nombre venga de la tabla activos
    const transformed = data?.map((c: any) => ({
      ticker: c.ticker,
      ratio: c.ratio,
      nombre: c.activos?.nombre ?? c.ticker
    })) ?? []

    return NextResponse.json(transformed)
  } catch (err) {
    console.error('Error fetching cedears:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}