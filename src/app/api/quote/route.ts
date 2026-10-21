import { NextRequest, NextResponse } from 'next/server'
import { getMarketDataProvider, MarketDataError } from '@/lib/market-data'
import { requireUser, isAuthFailure } from '@/lib/api-auth'

// Map MarketDataError codes to HTTP status codes
function errorToStatus(err: MarketDataError): number {
  switch (err.code) {
    case 'NOT_FOUND':           return 404
    case 'RATE_LIMITED':        return 429
    case 'PROVIDER_UNAVAILABLE': return 503
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

  let provider: ReturnType<typeof getMarketDataProvider>
  try {
    provider = getMarketDataProvider()
  } catch (err) {
    console.error('[/api/quote]', err)
    return NextResponse.json({ error: 'Failed to fetch quotes' }, { status: 500 })
  }
  const settled = await Promise.allSettled(
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

  const results = settled.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { ticker: tickers[i], price: null, change: 0, change_pct: null, last_updated: null, unavailable: true }
  )
  const failures = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  failures.forEach(f => console.error('[/api/quote]', f.reason instanceof MarketDataError ? `${f.reason.code}: ${f.reason.message}` : f.reason))

  // Partial success: per-ticker entries, the healthy quotes still come back.
  if (failures.length < tickers.length) return NextResponse.json(results)

  const err = failures[0].reason
  if (err instanceof MarketDataError) {
    const message = err.code === 'NOT_FOUND' || err.code === 'RATE_LIMITED' ? err.message : 'Quotes are temporarily unavailable'
    return NextResponse.json({ error: message }, { status: errorToStatus(err) })
  }
  return NextResponse.json({ error: 'Failed to fetch quotes' }, { status: 500 })
}
