import { describe, it, expect } from 'vitest'
import { completeBars, foldLivePoint } from '../daily-bars'

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

describe('foldLivePoint', () => {
  // odd/tasks/chart-display.md S3, S5: Yahoo appends the last trade as a loose point after the current bar.
  const q = (iso: string, open: number, high: number, low: number, close: number | null, volume = 100) =>
    ({ date: new Date(iso), open, high, low, close, volume })

  it('weekly: the 2026-11-03 point folds into the week of 2026-11-02 instead of drawing a second candle', () => {
    const week = q('2026-11-02T05:00:00Z', 140, 142.4, 134.21, 139.59, 10_665_700)
    const out = foldLivePoint([q('2026-10-26T04:00:00Z', 140.9, 147.8, 135.9, 138.37), week, q('2026-11-03T21:00:03Z', 135.99, 142.4, 135.99, 139.59, 5_863_721)], '1wk')
    expect(out).toHaveLength(2)
    expect(out[1]).toEqual(week)
  })

  it('monthly: the point folds into the month of 2026-11-01', () => {
    const out = foldLivePoint([q('2026-10-01T04:00:00Z', 139, 170, 130, 138.37), q('2026-11-01T04:00:00Z', 140, 142.4, 134.21, 139.59), q('2026-11-03T21:00:03Z', 135.99, 142.4, 135.99, 139.59)], '1mo')
    expect(out.map((b) => b.date.toISOString().slice(0, 10))).toEqual(['2026-10-01', '2026-11-01'])
  })

  it('15m: the 11:16:19 point updates the 11:15 bar (its close, a wider high or low), volume unchanged', () => {
    const out = foldLivePoint([q('2026-11-04T11:00:00Z', 137, 137, 136.2, 136.27, 0), q('2026-11-04T11:15:00Z', 136.9, 137, 136.3, 136.4, 50), q('2026-11-04T11:16:19Z', 136.26, 136.26, 136.26, 136.26, 0)], '15m')
    expect(out).toHaveLength(2)
    expect(out[1]).toEqual(q('2026-11-04T11:15:00Z', 136.9, 137, 136.26, 136.26, 50))
  })

  it('fills a bar that came without its close', () => {
    const out = foldLivePoint([q('2026-11-02T14:30:00Z', 140, 140.5, 134.21, 134.61), q('2026-11-03T14:30:00Z', 135.99, 142.4, 135.99, null), q('2026-11-03T21:00:03Z', 139.59, 139.59, 139.59, 139.59)], '1d')
    expect(out).toHaveLength(2)
    expect(out[1].close).toBe(139.59)
  })

  it('never folds the bar of a new period, across the US clock changes too', () => {
    const series = (iso: string, interval: '1d' | '1wk' | '1mo' | '1h', next: string) =>
      foldLivePoint([q(iso, 1, 1, 1, 1), q(next, 2, 2, 2, 2)], interval).length
    // A day after the spring change opens an hour earlier in UTC: 23 h after the previous open.
    expect(series('2026-03-06T14:30:00Z', '1d', '2026-03-09T13:30:00Z')).toBe(2)
    expect(series('2026-03-08T14:30:00Z', '1d', '2026-03-09T13:30:00Z')).toBe(2)
    expect(series('2026-03-02T05:00:00Z', '1wk', '2026-03-09T04:00:00Z')).toBe(2)
    expect(series('2026-10-01T04:00:00Z', '1mo', '2026-11-01T04:00:00Z')).toBe(2)
    expect(series('2026-11-03T19:30:00Z', '1h', '2026-11-03T20:30:00Z')).toBe(2)
  })

  it('never folds into a padding bar without prices: the real point after it stays', () => {
    const pad = { date: new Date('2026-10-20T14:30:00Z'), open: null, high: null, low: null, close: null, volume: null }
    const real = q('2026-10-20T14:45:00Z', 150, 155, 148, 152)
    expect(foldLivePoint([pad, real], '1h')).toEqual([pad, real])
  })

  it('1h: a real bar 30 minutes after an extended-hours bar is a bar, not a live point (bars start on a quarter hour)', () => {
    const out = foldLivePoint([q('2026-11-04T14:00:00Z', 1, 1, 1, 1), q('2026-11-04T14:30:00Z', 2, 2, 2, 2)], '1h')
    expect(out).toHaveLength(2)
  })

  it('a closing print stamped on a quarter hour still folds when it is Yahoo\'s last trade (meta.regularMarketTime)', () => {
    const series = [q('2026-11-03T20:30:00Z', 1, 1, 1, 1), q('2026-11-03T20:45:00Z', 2, 2.5, 1.9, 2.1), q('2026-11-03T21:00:00Z', 2.2, 2.2, 2.2, 2.2, 0)]
    expect(foldLivePoint(series, '15m', new Date('2026-11-03T21:00:00Z'))).toHaveLength(2)
    expect(foldLivePoint(series, '15m', new Date('2026-11-03T21:00:00Z'))[1]).toMatchObject({ close: 2.2, high: 2.5 })
    // Without the last trade's time it reads as a bar, as a post-market 21:00 bar would be.
    expect(foldLivePoint(series, '15m')).toHaveLength(3)
  })

  it('the first trade of an intraday bar Yahoo has not drawn yet waits for it, instead of a sliver off the grid', () => {
    // 12:00:28: the 12:00 bar does not exist yet, so the point lies past the 11:45 bar.
    expect(foldLivePoint([q('2026-11-04T11:30:00Z', 1, 1, 1, 1), q('2026-11-04T11:45:00Z', 2, 2, 2, 2), q('2026-11-04T12:00:28Z', 3, 3, 3, 3)], '15m').map((b) => b.date.toISOString().slice(11, 16))).toEqual(['11:30', '11:45'])
    expect(foldLivePoint([q('2026-11-04T10:00:00Z', 1, 1, 1, 1), q('2026-11-04T11:00:00Z', 2, 2, 2, 2), q('2026-11-04T12:00:19Z', 3, 3, 3, 3)], '1h')).toHaveLength(2)
    // A daily, weekly or monthly bar past the last one is a real bar.
    expect(foldLivePoint([q('2026-11-02T14:30:00Z', 1, 1, 1, 1), q('2026-11-03T14:30:00Z', 2, 2, 2, 2)], '1d')).toHaveLength(2)
  })

  it('a week or month bar that does not count the last session yet takes the point\'s volume too', () => {
    // GGAL.BA in November: the month bar holds 2026-11-02 (close 5200), the point 2026-11-03 (close 5255).
    const out = foldLivePoint([q('2026-10-01T03:00:00Z', 5000, 6000, 4800, 5100, 90_000_000), q('2026-11-01T03:00:00Z', 5375, 5400, 5095, 5200, 3_330_711), q('2026-11-03T20:59:58Z', 5250, 5500, 5200, 5255, 2_852_710)], '1mo')
    expect(out[1]).toMatchObject({ close: 5255, high: 5500, volume: 3_330_711 + 2_852_710 })
  })

  it('a bar without volume takes the point\'s', () => {
    const out = foldLivePoint([q('2026-11-02T14:30:00Z', 1, 1, 1, 1), { ...q('2026-11-03T14:30:00Z', 135.99, 142.4, 135.99, null), volume: null }, q('2026-11-03T21:00:03Z', 139.59, 139.59, 139.59, 139.59, 5_863_721)], '1d')
    expect(out[1]).toMatchObject({ close: 139.59, volume: 5_863_721 })
  })

  it('folds a Sunday point into its week on a 24/7 series, and a late point into its day', () => {
    expect(foldLivePoint([q('2026-11-02T00:00:00Z', 1, 1, 1, 1), q('2026-11-08T20:00:00Z', 2, 2, 2, 2)], '1wk')).toHaveLength(1)
    expect(foldLivePoint([q('2026-11-04T00:00:00Z', 1, 1, 1, 1), q('2026-11-04T21:30:17Z', 2, 2, 2, 2)], '1d')).toHaveLength(1)
  })

  it('leaves a series of one bar, or none, as it is', () => {
    expect(foldLivePoint([], '1d')).toEqual([])
    const one = [q('2026-11-03T14:30:00Z', 1, 1, 1, 1)]
    expect(foldLivePoint(one, '1d')).toEqual(one)
  })
})
