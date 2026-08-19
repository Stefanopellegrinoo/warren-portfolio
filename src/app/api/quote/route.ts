import { NextRequest, NextResponse } from 'next/server'
import { getMarketDataProvider, MarketDataError } from '@/lib/market-data'
import { requireUser, isAuthFailure } from '@/lib/api-auth'

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
  const { searchParams } = req.nextUrl
  const raw = searchParams.get('tickers') ?? searchParams.get('ticker') ?? ''
  const tickers = raw.split(',').map(t => t.trim().toUpperCase()).filter(Boolean)

  if (tickers.length === 0) {
    return NextResponse.json({ error: 'tickers required' }, { status: 400 })
  }

  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error

  try {
    const provider = getMarketDataProvider()
    const results = await Promise.all(
      tickers.map(async (ticker) => {
        const q = await provider.getQuote(ticker)
        return {
          ticker: q.ticker,
          price: q.price,
          change: q.change ?? 0,
          change_pct: q.changePercent,
          last_updated: q.updatedAt,
        }
      })
    )

    return NextResponse.json(results)
  } catch (err) {
    if (err instanceof MarketDataError) {
      console.error(`[/api/quote] ${err.code}: ${err.message}`)
      return NextResponse.json({ error: err.message }, { status: errorToStatus(err) })
    }
    console.error('[/api/quote]', err)
    return NextResponse.json({ error: 'Failed to fetch quotes' }, { status: 500 })
  }
}
