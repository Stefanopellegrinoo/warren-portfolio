import { describe, it, expect } from 'vitest'
import { timeframesFor, coerceTimeframe, klinesInterval, toChartTime} from '../timeframes'

describe('timeframesFor', () => {
  it('offers only what Yahoo serves for stocks', () => {
    expect(timeframesFor('yahoo')).toEqual(['15m', '1h', '1d', '1w', '1M'])
  })

  it('offers intraday down to 1m for Binance', () => {
    expect(timeframesFor('binance')).toEqual(['1m', '5m', '15m', '1h', '4h', '1d', '1w'])
  })
})

describe('coerceTimeframe', () => {
  it('keeps a timeframe the source offers', () => {
    expect(coerceTimeframe('1h', 'yahoo')).toBe('1h')
  })

  it('falls back to 1d when the source cannot serve it', () => {
    expect(coerceTimeframe('5m', 'yahoo')).toBe('1d')
    expect(coerceTimeframe('1M', 'binance')).toBe('1d')
  })
})

describe('klinesInterval', () => {
  it('maps chart timeframes to /api/klines intervals', () => {
    expect(['15m', '1h', '1d', '1w', '1M'].map((t) => klinesInterval(t as never))).toEqual(['15m', '1h', '1d', '1w', '1mo'])
  })
})

describe('toChartTime', () => {
  it('turns a business day into UTC midnight seconds', () => {
    expect(toChartTime('2025-03-31')).toBe(1743379200)
  })

  it('passes UTC seconds through', () => {
    expect(toChartTime(1792506600)).toBe(1792506600)
  })
})
