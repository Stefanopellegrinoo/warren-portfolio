import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ALERT_LINES, ALERT_OPERATORS, ALERT_TIMEFRAMES, indicatorsOf, isPriceValue } from '../alert-condition'

const sql = readFileSync('supabase/migrations/052_alert_conditions.sql', 'utf8')
// The quoted values of one CHECK of migration 052.
const listed = (constraint: string) => {
  // The last one: the rollback note at the top names the old operator and status checks.
  const body = sql.slice(sql.lastIndexOf(`add constraint ${constraint} check`)).split(/\)\),?\n/)[0]
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1])
}

describe('the lines an alert can watch', () => {
  it('are every indicator line the chart restyles, no histograms: MACD and its signal, the three bands, K and D, the ADX lines', () => {
    expect(ALERT_LINES).toEqual([
      'ema20.ema20', 'ema50.ema50', 'ema200.ema200', 'rsi.rsi', 'macd.macd', 'macd.signal',
      'bollinger.upper', 'bollinger.middle', 'bollinger.lower', 'obv.obv', 'stochastic.k', 'stochastic.d',
      'adx.adx', 'adx.plusDI', 'adx.minusDI',
    ])
  })

  it('are the ones migration 052 allows as a source and as a target', () => {
    expect(listed('price_alerts_source_check')).toEqual(['price', ...ALERT_LINES])
    expect(listed('price_alerts_target_check')).toEqual(['value', 'price', ...ALERT_LINES])
  })

  it('the crossings and timeframes are the ones migration 052 allows', () => {
    expect(listed('price_alerts_operator_check')).toEqual([...ALERT_OPERATORS])
    expect(listed('price_alerts_timeframe_check')).toEqual([...ALERT_TIMEFRAMES])
  })
})

describe('indicatorsOf', () => {
  it('names each indicator a condition computes once', () => {
    expect(indicatorsOf({ source: 'price', target: 'value' })).toEqual([])
    expect(indicatorsOf({ source: 'price', target: 'ema50.ema50' })).toEqual(['ema50'])
    expect(indicatorsOf({ source: 'macd.macd', target: 'macd.signal' })).toEqual(['macd'])
    expect(indicatorsOf({ source: 'ema20.ema20', target: 'ema50.ema50' })).toEqual(['ema20', 'ema50'])
  })
})

describe('isPriceValue', () => {
  it('is the price against a value, the only alert there was before', () => {
    expect(isPriceValue({ source: 'price', target: 'value' })).toBe(true)
    expect(isPriceValue({ source: 'rsi.rsi', target: 'value' })).toBe(false)
    expect(isPriceValue({ source: 'price', target: 'ema50.ema50' })).toBe(false)
  })
})
