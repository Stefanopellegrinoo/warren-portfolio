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
  const ticker = searchParams.get('ticker')?.toUpperCase()
  const interval = (searchParams.get('interval') ?? '1d') as '1d' | '1w'
  const daysParam = searchParams.get('days')

  if (!ticker) {
    return NextResponse.json({ error: 'ticker required' }, { status: 400 })
  }

  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error

  // days is optional — when absent, provider fetches full history (from = undefined)
  const from = daysParam != null
    ? (() => {
        const d = new Date()
        d.setDate(d.getDate() - parseInt(daysParam, 10))
        return d
      })()
    : undefined

  try {
    const provider = getMarketDataProvider()
    const candles = await provider.getCandles(ticker, interval, from)
    return NextResponse.json(candles)
  } catch (err) {
    if (err instanceof MarketDataError) {
      console.error(`[/api/klines] ${err.code}: ${err.message}`)
      return NextResponse.json({ error: err.message }, { status: errorToStatus(err) })
    }
    console.error('[/api/klines]', err)
    return NextResponse.json({ error: 'Failed to fetch klines' }, { status: 500 })
  }
}
