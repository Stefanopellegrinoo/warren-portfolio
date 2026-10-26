import { describe, it, expect } from 'vitest'
import { parseCompareSymbols, isArsSymbol, yahooSymbol, toUsdDaily, PORTFOLIO_SERIES } from '../compare-series'

describe('parseCompareSymbols', () => {
  it('trims, uppercases and drops repeats, keeping the order', () => {
    expect(parseCompareSymbols('spy, dia,SPY')).toEqual(['SPY', 'DIA'])
  })

  it('keeps index, Buenos Aires and portfolio symbols as they are', () => {
    expect(parseCompareSymbols(`^MERV,GGAL.BA,${PORTFOLIO_SERIES}`)).toEqual(['^MERV', 'GGAL.BA', '__portfolio__'])
  })

  it('refuses nothing, more than five, and anything that is not a ticker', () => {
    expect(parseCompareSymbols('')).toBeNull()
    expect(parseCompareSymbols(null)).toBeNull()
    expect(parseCompareSymbols('A,B,C,D,E,F')).toBeNull()
    expect(parseCompareSymbols('SPY;DROP')).toBeNull()
  })
})

describe('isArsSymbol', () => {
  it('is true for Buenos Aires tickers and the MERVAL, false for the rest', () => {
    expect(isArsSymbol('GGAL.BA')).toBe(true)
    expect(isArsSymbol('^MERV')).toBe(true)
    expect(isArsSymbol('SPY')).toBe(false)
  })
})

describe('yahooSymbol', () => {
  it('turns a Binance USDT pair into its Yahoo USD pair and leaves the rest alone', () => {
    expect(yahooSymbol('BTCUSDT')).toBe('BTC-USD')
    expect(yahooSymbol('SPY')).toBe('SPY')
  })
})

describe('toUsdDaily', () => {
  it('divides each close by that day’s CCL', () => {
    const bars = [{ date: '2026-01-02', close: 10000 }, { date: '2026-01-05', close: 12100 }]
    const ccl = [{ date: '2026-01-02', close: 1000 }, { date: '2026-01-05', close: 1100 }]
    expect(toUsdDaily(bars, ccl)).toEqual([{ time: '2026-01-02', value: 10 }, { time: '2026-01-05', value: 11 }])
  })

  it('carries the CCL forward over a day without one and drops days before the first', () => {
    const bars = [{ date: '2026-01-01', close: 5 }, { date: '2026-01-02', close: 1000 }, { date: '2026-01-05', close: 2000 }]
    const ccl = [{ date: '2026-01-02', close: 1000 }]
    expect(toUsdDaily(bars, ccl)).toEqual([{ time: '2026-01-02', value: 1 }, { time: '2026-01-05', value: 2 }])
  })

  it('without a CCL the closes are already USD', () => {
    expect(toUsdDaily([{ date: '2026-01-02', close: 400 }])).toEqual([{ time: '2026-01-02', value: 400 }])
  })
})
