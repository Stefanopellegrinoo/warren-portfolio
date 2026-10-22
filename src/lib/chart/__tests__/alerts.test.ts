import { describe, it, expect } from 'vitest'
import { hitTestAlert, operatorFor, alertName } from '../alerts'

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
})
