import { describe, it, expect } from 'vitest'
import { completeBars } from '../daily-bars'

const bar = (day: string, over: Record<string, unknown> = {}) =>
  ({ date: new Date(`${day}T14:30:00Z`), open: 10, high: 12, low: 9, close: 11, volume: 100, ...over })

describe('completeBars', () => {
  it('closes today\'s bar at the live price when Yahoo leaves its close empty, widening high and low', () => {
    const out = completeBars({
      quotes: [bar('2026-11-02'), bar('2026-11-03', { close: null })],
      meta: { regularMarketPrice: 13, regularMarketTime: new Date('2026-11-03T21:00:00Z') },
    })
    expect(out.at(-1)).toMatchObject({ open: 10, high: 13, low: 9, close: 13 })
    expect(out).toHaveLength(2)
  })

  it('drops an incomplete bar the live price does not belong to', () => {
    const out = completeBars({
      quotes: [bar('2026-11-02', { close: null }), bar('2026-11-03')],
      meta: { regularMarketPrice: 13, regularMarketTime: new Date('2026-11-03T21:00:00Z') },
    })
    expect(out.map((b) => b.date.toISOString().slice(0, 10))).toEqual(['2026-11-03'])
  })

  it('drops the gap bars chart() pads with nulls, and leaves a complete series as it is', () => {
    const series = [bar('2026-11-02'), bar('2026-11-03')]
    expect(completeBars({ quotes: [...series, bar('2026-11-04', { open: null, high: null, low: null, close: null })] })).toEqual(series)
  })
})
