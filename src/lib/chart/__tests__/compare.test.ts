import { describe, it, expect } from 'vitest'
import { COMPARE_TIMEFRAMES, COMPARE_RANGES, alignToBars, toUsdCandles, portfolioDayChangePct, pctFrom, rangeStart, compareBase, scaleToBase } from '../compare'
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

  it('a pointer before the base day reads its change against that day too', () => {
    expect(pctFrom(points, 20, 10)).toBeCloseTo((100 / 110 - 1) * 100)
  })

  it('no points, or a pointer before every point, gives nothing', () => {
    expect(pctFrom([], null, null)).toBeNull()
    expect(pctFrom(points, 20, 5)).toBeNull()
  })
})

describe('rangeStart', () => {
  const last = t('2026-10-26')

  it('counts calendar months and years back from the last bar', () => {
    expect(COMPARE_RANGES).toEqual(['1M', '3M', '6M', 'YTD', '1A', 'Todo'])
    expect(rangeStart('1M', last)).toBe(t('2026-09-26'))
    expect(rangeStart('3M', last)).toBe(t('2026-07-26'))
    expect(rangeStart('6M', last)).toBe(t('2026-04-26'))
    expect(rangeStart('1A', last)).toBe(t('2025-10-26'))
  })

  it('YTD starts on January 1st of the last bar\'s year; Todo has no start', () => {
    expect(rangeStart('YTD', last)).toBe(t('2026-01-01'))
    expect(rangeStart('Todo', last)).toBeNull()
  })
})

describe('compareBase', () => {
  const bars = ['2026-01-02', '2026-01-05', '2026-01-06', '2026-01-07'].map((d, i) => ({ time: t(d), close: 10 + i }))

  it('is the first bar on or after the range start', () => {
    expect(compareBase(bars, [], '1M')).toEqual({ index: 0, time: t('2026-01-02'), close: 10 })
  })

  it('with Todo, or a range reaching before a compared series begins, it is the first day every line has', () => {
    const late = [{ time: t('2026-01-06'), value: 400 }, { time: t('2026-01-07'), value: 410 }]
    expect(compareBase(bars, [late], 'Todo')).toEqual({ index: 2, time: t('2026-01-06'), close: 12 })
    expect(compareBase(bars, [late], '1A')).toEqual({ index: 2, time: t('2026-01-06'), close: 12 })
  })

  it('a series with no points does not hold the others back; no bars, no base', () => {
    expect(compareBase(bars, [[]], 'Todo')).toEqual({ index: 0, time: t('2026-01-02'), close: 10 })
    expect(compareBase([], [], 'Todo')).toBeNull()
  })
})

describe('scaleToBase', () => {
  it('draws a series in the chart\'s own units, starting at the chart\'s close on the base day', () => {
    const points = [{ time: 1, value: 400 }, { time: 2, value: 440 }, { time: 3, value: 380 }]
    expect(scaleToBase(points, 2, 100)).toEqual([{ time: 1, value: 400 / 440 * 100 }, { time: 2, value: 100 }, { time: 3, value: 380 / 440 * 100 }])
  })

  it('with no value on or after the base day there is nothing to draw', () => {
    expect(scaleToBase([{ time: 1, value: 400 }], 2, 100)).toEqual([])
  })
})
