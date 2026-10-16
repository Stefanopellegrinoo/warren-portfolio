import { describe, it, expect } from 'vitest'
import { compareToBenchmark } from '../benchmark'
import type { TwrPoint } from '../twr-series'

const twr = (date: string, twrIndex: number): TwrPoint => ({ date, twrIndex, twrPct: (twrIndex - 1) * 100 })
// 1.00 -> 1.10 -> 1.21 (two +10% intervals)
const series = [twr('2024-01-02', 1), twr('2024-01-03', 1.1), twr('2024-01-04', 1.21)]

describe('compareToBenchmark', () => {
  it('aligns with carry-forward and rebases both lines to 0% at the start', () => {
    // 01-03 has no bar: carries 100 forward. Bench: 0%, 0%, +5%.
    const r = compareToBenchmark(series, [
      { date: '2024-01-02', close: 100 },
      { date: '2024-01-04', close: 105 },
    ])!
    expect(r.points.map((p) => p.benchmarkPct)).toEqual([0, 0, expect.closeTo(5, 9)])
    expect(r.points[2].portfolioPct).toBeCloseTo(21, 9)
    expect(r.excessPp).toBeCloseTo(16, 9) // 21 - 5
  })

  it('starts at the first COMMON date and rebases the portfolio there too', () => {
    // Benchmark has no data before 01-03: portfolio is rebased to 1.10.
    const r = compareToBenchmark(series, [
      { date: '2024-01-03', close: 200 },
      { date: '2024-01-04', close: 210 },
    ])!
    expect(r.points.map((p) => p.date)).toEqual(['2024-01-03', '2024-01-04'])
    expect(r.points[0]).toEqual({ date: '2024-01-03', portfolioPct: 0, benchmarkPct: 0 })
    expect(r.points[1].portfolioPct).toBeCloseTo(10, 9) // 1.21 / 1.10 - 1
    expect(r.excessPp).toBeCloseTo(5, 9) // 10 - 5
  })

  it('converts ARS bars to USD dividing by that day\'s CCL (carried forward)', () => {
    // ARS nominal is +20%, but USD is flat at the end: 1000/1000, 1100/1000, 1200/1200.
    const r = compareToBenchmark(
      series,
      [
        { date: '2024-01-02', close: 1000 },
        { date: '2024-01-03', close: 1100 },
        { date: '2024-01-04', close: 1200 },
      ],
      [
        { date: '2024-01-02', close: 1000 },
        { date: '2024-01-04', close: 1200 }, // 01-03 carries 1000
      ]
    )!
    expect(r.points.map((p) => p.benchmarkPct)).toEqual([0, expect.closeTo(10, 9), 0])
    expect(r.excessPp).toBeCloseTo(21, 9)
  })

  it('returns null when there is no overlap or no TWR series', () => {
    expect(compareToBenchmark(series, [])).toBeNull()
    expect(compareToBenchmark(series, [{ date: '2024-01-02', close: 1 }], [])).toBeNull()
    expect(compareToBenchmark([], [{ date: '2024-01-02', close: 1 }])).toBeNull()
  })
})
