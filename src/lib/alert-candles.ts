/**
 * The candles an indicator alert is checked on (odd/tasks/chart-customization.md S7): the ones the chart
 * draws for that ticker and timeframe, from the same sources and with the same history, so a line here is
 * the line there. Relative imports only: the worker loads this with tsx, without the `@/` paths.
 */
import type { Candle, Timeframe } from './binance/types'
import { fetchServerKlines } from './binance/rest'
import { getMarketDataProvider, MarketDataError } from './market-data'
import { getProviderForSymbol } from './market-data/resolver'
import { klinesInterval, timeframesFor, toChartTime } from './chart/timeframes'

/**
 * 'unknown' and 'empty' do not pass by asking again (a ticker the source does not know, no candles for
 * that timeframe); 'transient' may (a timeout, a 5xx, a rate limit, a dropped connection).
 */
export type CandleLoad = { ok: true; candles: Candle[] } | { ok: false; kind: 'unknown' | 'empty' | 'transient'; error: string }

/** A source that never answers must not hold the price cycle. */
export const CANDLE_TIMEOUT_MS = 10_000
/** What the chart loads: Binance's last 1000 bars (useCandles → fetchKlines), Yahoo the days per interval
 *  of src/app/api/klines/route.ts (DEFAULT_DAYS; null is the whole history). */
const BINANCE_BARS = 1000
const YAHOO_DAYS: Record<ReturnType<typeof klinesInterval>, number | null> = { '15m': 59, '1h': 729, '1d': 3650, '1w': null, '1mo': null }
const DAY_MS = 86_400_000

async function yahooCandles(ticker: string, timeframe: Timeframe): Promise<Candle[]> {
  const interval = klinesInterval(timeframe)
  const days = YAHOO_DAYS[interval]
  const bars = await getMarketDataProvider().getCandles(ticker.toUpperCase(), interval, days === null ? undefined : new Date(Date.now() - days * DAY_MS))
  return bars.map((k) => ({ time: toChartTime(k.time), open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume ?? 0 }))
}

function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer in ${CANDLE_TIMEOUT_MS} ms`)), CANDLE_TIMEOUT_MS)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

export async function loadCandles(ticker: string, timeframe: Timeframe): Promise<CandleLoad> {
  const source = getProviderForSymbol(ticker)
  // Yahoo has no 4h bars: asking would draw daily ones under that label (timeframes.ts).
  if (!timeframesFor(source).includes(timeframe)) return { ok: false, kind: 'empty', error: `${source} has no ${timeframe} candles` }
  try {
    const candles = await withTimeout(source === 'binance' ? fetchServerKlines(ticker, timeframe, BINANCE_BARS) : yahooCandles(ticker, timeframe))
    return candles.length ? { ok: true, candles } : { ok: false, kind: 'empty', error: 'no candles' }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    // Binance answers an unknown symbol with a 400 (fetchKlines throws "klines <status>").
    const unknown = (err instanceof MarketDataError && err.code === 'NOT_FOUND') || /^klines 400\b/.test(error)
    return { ok: false, kind: unknown ? 'unknown' : 'transient', error }
  }
}
