import { describe, it, expect } from 'vitest'
import { COMPARE_TIMEFRAMES, alignToBars, toUsdCandles, portfolioDayChangePct, pctFrom } from '../compare'
import { toChartTime } from '../timeframes'

const t = (day: string) => toChartTime(day)

describe('COMPARE_TIMEFRAMES', () => {
  it('is daily, weekly and monthly only', () => {
    expect(COMPARE_TIMEFRAMES).toEqual(['1d', '1w', '1M'])
  })
})

describe('alignToBars', () => {
  it('on a daily chart each bar takes its own day', () => {
    const daily = [{ time: '2026-01-05', value: 1 }, { time: '2026-01-06', value: 2 }]
    expect(alignToBars([t('2026-01-05'), t('2026-01-06')], daily)).toEqual([
      { time: t('2026-01-05'), value: 1 },
      { time: t('2026-01-06'), value: 2 },
    ])
  })

  it('on a weekly chart each bar takes the last close of its week', () => {
    const days = ['05', '06', '07', '08', '09', '12', '13', '14', '15', '16'].map((d, i) => ({ time: `2026-01-${d}`, value: i + 1 }))
    expect(alignToBars([t('2026-01-05'), t('2026-01-12')], days)).toEqual([
      { time: t('2026-01-05'), value: 5 },
      { time: t('2026-01-12'), value: 10 },
    ])
  })

  it('a bar before the series starts gets no point; a gap carries the last close forward', () => {
    const daily = [{ time: '2026-01-06', value: 7 }]
    expect(alignToBars([t('2026-01-05'), t('2026-01-06'), t('2026-01-07')], daily)).toEqual([
      { time: t('2026-01-06'), value: 7 },
      { time: t('2026-01-07'), value: 7 },
    ])
  })
})

describe('toUsdCandles', () => {
  it('divides open, high, low and close by that day’s CCL', () => {
    const candles = [{ time: t('2026-01-05'), open: 1000, high: 1100, low: 900, close: 1050, volume: 3 }]
    expect(toUsdCandles(candles, [{ time: '2026-01-02', value: 1000 }])).toEqual([
      { time: t('2026-01-05'), open: 1, high: 1.1, low: 0.9, close: 1.05, volume: 3 },
    ])
  })

  it('drops candles before the first CCL', () => {
    const candles = [{ time: t('2026-01-01'), open: 1, high: 1, low: 1, close: 1, volume: 0 }]
    expect(toUsdCandles(candles, [{ time: '2026-01-02', value: 1000 }])).toEqual([])
  })
})

describe('portfolioDayChangePct', () => {
  it('weights each position’s change by its market value', () => {
    expect(portfolioDayChangePct([{ market_value: 300, day_change_pct: 2 }, { market_value: 100, day_change_pct: -2 }])).toBe(1)
  })

  it('is null with nothing held', () => {
    expect(portfolioDayChangePct([])).toBeNull()
  })
})

describe('pctFrom', () => {
  const points = [{ time: 10, value: 100 }, { time: 20, value: 110 }, { time: 30, value: 121 }]

  it('is the change from the first bar in sight to the bar pointed at', () => {
    expect(pctFrom(points, 20, 30)).toBeCloseTo(10)
  })

  it('without a pointer it reads the last bar; without a range, from the first', () => {
    expect(pctFrom(points, null, null)).toBeCloseTo(21)
  })

  it('a pointer before the first bar in sight, or no points, gives nothing', () => {
    expect(pctFrom(points, 20, 10)).toBeNull()
    expect(pctFrom([], null, null)).toBeNull()
  })
})
