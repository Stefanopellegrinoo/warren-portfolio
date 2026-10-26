import type { Timeframe } from '@/lib/binance/types'
import type { DataSource } from '@/lib/market-data/resolver'

type KlinesInterval = '15m' | '1h' | '1d' | '1w' | '1mo'

// Only timeframes the source really serves: Yahoo has no 1m/5m/4h history,
// and offering them used to draw daily bars under an intraday label.
const OFFERED: Record<DataSource, Timeframe[]> = {
  yahoo: ['15m', '1h', '1d', '1w', '1M'],
  binance: ['1m', '5m', '15m', '1h', '4h', '1d', '1w'],
  // Mi cartera has one value per day.
  portfolio: ['1d'],
}

export function timeframesFor(source: DataSource): Timeframe[] {
  return OFFERED[source]
}

export function coerceTimeframe(tf: Timeframe, source: DataSource): Timeframe {
  return OFFERED[source].includes(tf) ? tf : '1d'
}

export function klinesInterval(tf: Timeframe): KlinesInterval {
  return tf === '1M' ? '1mo' : (tf as KlinesInterval)
}

/** /api/klines sends business days for daily+ and UTC seconds intraday. */
export function toChartTime(time: string | number): number {
  return typeof time === 'number' ? time : Date.parse(`${time}T00:00:00Z`) / 1000
}
