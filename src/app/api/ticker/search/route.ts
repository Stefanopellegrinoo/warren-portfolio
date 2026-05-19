import { NextRequest, NextResponse } from 'next/server'
import { getMarketDataProvider, MarketDataError } from '@/lib/market-data'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { getCachedRoute, cacheRoute } from '@/lib/redis'

const CACHE_TTL_SECONDS = 600

// Map MarketDataError codes to HTTP status codes
function errorToStatus(err: MarketDataError): number {
  switch (err.code) {
    case 'NOT_FOUND':           return 404
    case 'RATE_LIMITED':        return 429
    case 'PROVIDER_UNAVAILABLE':
    case 'UNKNOWN':
    default:                    return 500
  }
}

export async function GET(req: NextRequest) {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error

  const { searchParams } = req.nextUrl
  const rawQ = searchParams.get('q')

  if (!rawQ) {
    return NextResponse.json({ error: 'q parameter is required' }, { status: 400 })
  }

  const q = rawQ.toLowerCase().trim()

  if (q.length < 2) {
    return NextResponse.json({ error: 'q must be at least 2 characters' }, { status: 400 })
  }

  const cacheKey = `ticker-search:${q}`

  // Cache hit — return without calling Yahoo
  const cached = await getCachedRoute(cacheKey)
  if (cached) {
    return NextResponse.json({ results: cached })
  }

  // Cache miss — call provider
  try {
    const provider = getMarketDataProvider()
    const results = await provider.searchTickers(q)

    // Store in cache (fire-and-forget pattern — consistent with cache.ts style)
    cacheRoute(cacheKey, results, CACHE_TTL_SECONDS).catch((err) => {
      console.warn('[/api/ticker/search] Failed to cache results:', err)
    })

    return NextResponse.json({ results })
  } catch (err) {
    if (err instanceof MarketDataError) {
      console.error(`[/api/ticker/search] ${err.code}: ${err.message}`)
      return NextResponse.json({ error: err.message }, { status: errorToStatus(err) })
    }
    console.error('[/api/ticker/search]', err)
    return NextResponse.json({ error: 'Failed to search tickers' }, { status: 500 })
  }
}
