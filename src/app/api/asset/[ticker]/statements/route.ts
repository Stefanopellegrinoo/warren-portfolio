import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'
import { marketDataMessage, serverError } from '@/lib/api/errors'
import { AssetError, getAssetStatements } from '@/lib/fundamentals/service'

export const dynamic = 'force-dynamic'

// Per-user limit, the asset route's (odd/tasks/asset-page.md S12).
const ROUTE_LIMIT = 60
const ROUTE_WINDOW_SEC = 60

// Same message as /api/asset/[ticker]: a route file may export only route fields.
const INVALID = 'Ese ticker no es válido. Revisá cómo está escrito.'

/**
 * GET /api/asset/[ticker]/statements — Balances completos (AssetStatements in src/lib/fundamentals/statements.ts).
 * Read only: the page's own Redis copies, nothing in Supabase.
 */
export async function GET(_req: NextRequest, { params }: { params: { ticker: string } }) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error
  if (!(await rateLimit(`rl:asset-statements:${auth.user.id}`, ROUTE_LIMIT, ROUTE_WINDOW_SEC))) {
    return tooManyRequests(ROUTE_WINDOW_SEC)
  }

  let ticker: string
  try {
    // `BCBA:GGAL` may arrive as `BCBA%3AGGAL`.
    ticker = decodeURIComponent(params.ticker)
  } catch {
    return NextResponse.json({ error: INVALID }, { status: 400 })
  }

  try {
    return NextResponse.json(await getAssetStatements(ticker))
  } catch (err) {
    if (err instanceof AssetError) {
      return err.code === 'invalid'
        ? NextResponse.json({ error: INVALID }, { status: 400 })
        : NextResponse.json({ error: marketDataMessage('NOT_FOUND') }, { status: 404 })
    }
    return serverError('/api/asset/statements', err)
  }
}
