import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'
import { marketDataMessage, serverError } from '@/lib/api/errors'
import { AssetError, getAssetPage } from '@/lib/fundamentals/service'

export const dynamic = 'force-dynamic'

// Per-user limit, like ticker search (odd/tasks/asset-page.md S12).
const ROUTE_LIMIT = 60
const ROUTE_WINDOW_SEC = 60

const INVALID = 'Ese ticker no es válido. Revisá cómo está escrito.'

/**
 * GET /api/asset/[ticker]?vs=AMZN,SE — the asset page's data (AssetPage in src/lib/fundamentals/service.ts).
 * `vs` replaces the default peers (up to 5). Read only: market data in Redis, nothing in Supabase.
 */
export async function GET(req: NextRequest, { params }: { params: { ticker: string } }) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error
  if (!(await rateLimit(`rl:asset:${auth.user.id}`, ROUTE_LIMIT, ROUTE_WINDOW_SEC))) {
    return tooManyRequests(ROUTE_WINDOW_SEC)
  }

  let ticker: string
  try {
    // `BCBA:GGAL` may arrive as `BCBA%3AGGAL`.
    ticker = decodeURIComponent(params.ticker)
  } catch {
    return NextResponse.json({ error: INVALID }, { status: 400 })
  }
  const vs = req.nextUrl.searchParams.get('vs')

  try {
    return NextResponse.json(await getAssetPage(ticker, vs === null ? null : vs.split(',').filter(Boolean)))
  } catch (err) {
    if (err instanceof AssetError) {
      return err.code === 'invalid'
        ? NextResponse.json({ error: INVALID }, { status: 400 })
        : NextResponse.json({ error: marketDataMessage('NOT_FOUND') }, { status: 404 })
    }
    return serverError('/api/asset', err)
  }
}
