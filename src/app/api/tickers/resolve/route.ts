import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { resolveTickerIdentity } from '@/lib/ticker-identity'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

// The ticker becomes a Redis key and Redis runs noeviction (S5).
const MAX_TICKER_LENGTH = 64
const ROUTE_LIMIT = 60
const ROUTE_WINDOW_SEC = 60

export async function GET(req: NextRequest) {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error
  if (!(await rateLimit(`rl:tickers-resolve:${authResult.user.id}`, ROUTE_LIMIT, ROUTE_WINDOW_SEC))) {
    return tooManyRequests(ROUTE_WINDOW_SEC)
  }

  const ticker = new URL(req.url).searchParams.get('ticker')
  if (!ticker || !ticker.trim()) {
    return NextResponse.json({ error: 'Ingresá el ticker' }, { status: 400 })
  }
  if (ticker.length > MAX_TICKER_LENGTH) {
    return NextResponse.json({ error: `El ticker puede tener hasta ${MAX_TICKER_LENGTH} caracteres` }, { status: 400 })
  }

  try {
    return NextResponse.json(await resolveTickerIdentity(ticker))
  } catch (err) {
    // Never answer "unverified but proceed" — the caller must know verification
    // was impossible, not that the ticker was fine.
    console.error('[TickerResolve] resolution failed:', err)
    return NextResponse.json(
      { error: 'No se pudo verificar el ticker en este momento. Probá de nuevo en unos minutos.' },
      { status: 503 }
    )
  }
}
