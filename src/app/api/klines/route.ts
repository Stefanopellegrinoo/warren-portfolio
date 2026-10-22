import { NextRequest, NextResponse } from 'next/server'
import { getMarketDataProvider, MarketDataError } from '@/lib/market-data'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { cached } from '@/lib/cache'
import type { CandleInterval } from '@/lib/market-data'

// Days of history per interval when the caller sends no `days`. Intraday limits
// are Yahoo's (15m: 60 days, 1h: 730 days); null = full history.
const DEFAULT_DAYS: Record<CandleInterval, number | null> = {
  '15m': 59,
  '1h': 729,
  '1d': 3650,
  '1w': null,
  '1mo': null,
}
const INTRADAY_TTL = 60
const DAILY_TTL = 900

function isInterval(v: string): v is CandleInterval {
  return v in DEFAULT_DAYS
}

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
  const interval = searchParams.get('interval') ?? '1d'
  const daysParam = searchParams.get('days')

  if (!ticker) {
    return NextResponse.json({ error: 'ticker required' }, { status: 400 })
  }
  if (!isInterval(interval)) {
    return NextResponse.json({ error: `unsupported interval: ${interval}` }, { status: 400 })
  }

  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error

  const days = daysParam != null ? parseInt(daysParam, 10) : DEFAULT_DAYS[interval]
  const from = days != null
    ? (() => {
        const d = new Date()
        d.setDate(d.getDate() - days)
        return d
      })()
    : undefined
  const ttl = interval === '15m' || interval === '1h' ? INTRADAY_TTL : DAILY_TTL

  try {
    const provider = getMarketDataProvider()
    const candles = await cached(`klines:${ticker}:${interval}:${days ?? 'all'}`, ttl, () =>
      provider.getCandles(ticker, interval, from)
    )
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
