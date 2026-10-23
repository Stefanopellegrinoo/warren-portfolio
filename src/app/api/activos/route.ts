import { NextRequest, NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'
import { normalizeError } from '@/lib/errors'
import { rateLimit, tooManyRequests, clientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

// Public, unauthenticated: limited per IP (S5).
const IP_LIMIT = 60
const IP_WINDOW_SEC = 60

export async function GET(req: NextRequest) {
  if (!(await rateLimit(`rl:activos:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_SEC))) {
    return tooManyRequests(IP_WINDOW_SEC)
  }
  try {
    const supabase = createServerClientInstance()
    
    const { data, error } = await supabase
      .from('activos')
      .select('ticker, nombre')
      .order('ticker')

    if (error) throw normalizeError(error)

    return NextResponse.json(data ?? [])
  } catch (err) {
    console.error('Error fetching activos:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}