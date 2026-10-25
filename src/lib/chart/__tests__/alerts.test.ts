import { describe, it, expect } from 'vitest'
import { hitTestAlert, operatorFor, alertName, conditionName, conditionText, lineLabel, restate } from '../alerts'

const priceToY = (p: number) => 1000 - p // 1 px per unit, inverted like a price axis

describe('hitTestAlert', () => {
  const alerts = [
    { id: 'a', value: 100 },
    { id: 'b', value: 104 },
  ]

  it('returns the closest alert line within the tolerance', () => {
    expect(hitTestAlert(alerts, 897, priceToY)).toBe('b') // y 896 vs 900
    expect(hitTestAlert(alerts, 899, priceToY)).toBe('a')
  })

  it('returns null when no line is within the tolerance', () => {
    expect(hitTestAlert(alerts, 880, priceToY)).toBeNull()
  })

  it('ignores alerts outside the visible price range', () => {
    expect(hitTestAlert([alerts[0]], 900, () => null)).toBeNull()
  })
})

describe('operatorFor', () => {
  it('watches for a cross above when the line sits above the last price', () => {
    expect(operatorFor(110, 100)).toBe('crosses_above')
  })

  it('watches for a cross below when the line sits at or below the last price', () => {
    expect(operatorFor(90, 100)).toBe('crosses_below')
    expect(operatorFor(100, 100)).toBe('crosses_below')
  })
})

describe('alertName', () => {
  it('reads like a sentence the notification can show', () => {
    expect(alertName('AAPL', 'crosses_above', 231.5)).toBe('AAPL cruza por encima de 231,50')
    expect(alertName('GGAL', 'crosses_below', 4.2)).toBe('GGAL cruza por debajo de 4,20')
  })

  it('a price under 1 keeps the four decimals the chart shows', () => {
    expect(alertName('DOGEUSDT', 'crosses_above', 0.1081)).toBe('DOGEUSDT cruza por encima de 0,1081')
  })
})

// odd/tasks/chart-customization.md S6: every condition in words, in the lists and in the sheet.
describe('conditions in words', () => {
  const priceValue = { source: 'price', target: 'value', timeframe: null, periods: null } as const
  const emaCross = { source: 'price', operator: 'crosses', target: 'ema50.ema50', value: null, timeframe: '1d', periods: { ema50: 50 } } as const
  const rsi70 = { source: 'rsi.rsi', operator: 'crosses_above', target: 'value', value: 70, timeframe: '1h', periods: { rsi: 14 } } as const

  it("an alert from before reads as it always did in the lists", () => {
    expect(conditionText({ ...priceValue, operator: 'crosses_above', value: 1234.5 })).toBe('Supera 1.234,50')
    expect(conditionText({ ...priceValue, operator: 'crosses_below', value: 0.1081 })).toBe('Baja de 0,1081')
  })

  it('a new condition names what crosses what, its timeframe and the way', () => {
    expect(conditionText({ ...priceValue, operator: 'crosses', value: 32.5 })).toBe('Precio cruza 32,50 · cualquiera')
    expect(conditionText(emaCross)).toBe('Precio cruza EMA 50 (1D) · cualquiera')
    expect(conditionText(rsi70)).toBe('RSI 14 cruza 70 (1h) · para arriba')
    expect(conditionText({ source: 'ema20.ema20', operator: 'crosses_below', target: 'ema50.ema50', value: null, timeframe: '4h', periods: { ema20: 21, ema50: 55 } }))
      .toBe('EMA 21 cruza EMA 55 (4h) · para abajo')
    expect(conditionText({ source: 'macd.macd', operator: 'crosses', target: 'macd.signal', value: null, timeframe: '1w', periods: { macdFast: 12, macdSlow: 26, macdSignal: 9 } }))
      .toBe('MACD 12 26 9 cruza MACD 12 26 9 señal (1S) · cualquiera')
  })

  it('the line names keep the periods of the alert', () => {
    expect(lineLabel('bollinger.upper', { bbPeriod: 20, bbStdDev: 2 })).toBe('BB 20 2 superior')
    expect(lineLabel('stochastic.k', { stochK: 14, stochSmooth: 3, stochD: 3 })).toBe('Estocástico 14 3 3 %K')
    expect(lineLabel('adx.minusDI', { adxPeriod: 14 })).toBe('ADX 14 -DI')
    expect(lineLabel('obv.obv', {})).toBe('OBV')
    expect(lineLabel('price', null)).toBe('Precio')
  })

  it('the sheet restates the condition as a sentence', () => {
    expect(restate('FXI', emaCross)).toBe('Te avisa una vez cuando el precio de FXI cruce la EMA 50, para arriba o para abajo.')
    expect(restate('FXI', rsi70)).toBe('Te avisa una vez cuando el RSI 14 de FXI cruce 70, para arriba.')
    expect(restate('FXI', { ...priceValue, operator: 'crosses_below', value: 32.5 })).toBe('Te avisa una vez cuando el precio de FXI cruce 32,50, para abajo.')
    expect(restate('FXI', { source: 'ema20.ema20', operator: 'crosses', target: 'price', value: null, timeframe: '1d', periods: { ema20: 20 } }))
      .toBe('Te avisa una vez cuando la EMA 20 de FXI cruce el precio, para arriba o para abajo.')
  })

  it("the name of a new condition is its ticker and its words; a price alert's stays today's", () => {
    expect(conditionName('FXI', rsi70)).toBe('FXI: RSI 14 cruza 70 (1h) · para arriba')
    expect(conditionName('FXI', { ...priceValue, operator: 'crosses_above', value: 32.5 })).toBe('FXI cruza por encima de 32,50')
  })
})
