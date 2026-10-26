import { NextRequest, NextResponse } from 'next/server'
import { getCachedRoute, cacheRoute } from '@/lib/redis'
import { serverError } from '@/lib/api/errors'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { getBars } from '@/lib/bars-cache'
import { getHistoricalCCL } from '@/lib/currency'
import { loadStocksTwr } from '@/lib/stocks-twr'
import {
  PORTFOLIO_SERIES,
  isArsSymbol,
  parseCompareSymbols,
  toUsdDaily,
  yahooSymbol,
  type CompareSeriesResponse,
  type SeriesResult,
} from '@/lib/compare-series'

export const dynamic = 'force-dynamic'

const YEARS_BACK = 10
// Today's bar still moves: the same freshness the statistics benchmark uses.
const MAX_AGE_SEC = 300

/** Daily USD series of up to five assets, the stock portfolio among them (`__portfolio__`). */
export async function GET(req: NextRequest) {
  try {
    const authResult = await requireUser()
    if (isAuthFailure(authResult)) return authResult.error
    const { supabase, user } = authResult

    const symbols = parseCompareSymbols(req.nextUrl.searchParams.get('symbols'))
    if (!symbols) return NextResponse.json({ error: 'Elegí entre 1 y 5 activos para comparar' }, { status: 400 })
    const wantsCcl = req.nextUrl.searchParams.get('ccl') === '1'

    // Under statistics:v4:{uid}:*, which invalidateUserCache clears after a trade.
    const cacheKey = `statistics:v4:${user.id}:compare:${[...symbols].sort().join(',')}${wantsCcl ? ':ccl' : ''}`
    const cached = await getCachedRoute<CompareSeriesResponse>(cacheKey)
    if (cached) return NextResponse.json(cached)

    const tickers = symbols.filter((s) => s !== PORTFOLIO_SERIES)
    const from = new Date()
    from.setFullYear(from.getFullYear() - YEARS_BACK)
    const needsCcl = wantsCcl || tickers.some(isArsSymbol)
    const [twr, bars, rates] = await Promise.all([
      symbols.includes(PORTFOLIO_SERIES) ? loadStocksTwr(supabase, user.id) : null,
      tickers.length ? getBars(tickers.map(yahooSymbol), from, { maxAgeSec: MAX_AGE_SEC }) : null,
      needsCcl ? getHistoricalCCL(from) : null,
    ])
    const ccl = rates ? [...rates].map(([date, close]) => ({ date, close: Number(close) })) : undefined

    const series: Record<string, SeriesResult> = {}
    for (const symbol of symbols) {
      let points
      if (symbol === PORTFOLIO_SERIES) points = (twr ?? []).map((p) => ({ time: p.date, value: p.twrIndex * 100 }))
      else {
        const daily = bars?.get(yahooSymbol(symbol))?.bars ?? []
        // A peso ticker with no CCL at all stays without data rather than drawn in pesos.
        points = isArsSymbol(symbol) ? (ccl?.length ? toUsdDaily(daily, ccl) : []) : toUsdDaily(daily)
      }
      series[symbol] = points.length ? { points } : { error: 'no_data' }
    }

    const body: CompareSeriesResponse = { series }
    if (wantsCcl && ccl) body.ccl = ccl.map((r) => ({ time: r.date, value: r.close }))
    await cacheRoute(cacheKey, body, MAX_AGE_SEC)
    return NextResponse.json(body)
  } catch (err) {
    return serverError('CompareSeries', err)
  }
}
