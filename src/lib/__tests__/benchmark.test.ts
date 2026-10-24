import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TwrPoint } from '../twr-series'

const mockGetBars = vi.fn()
vi.mock('../bars-cache', () => ({ getBars: (...a: unknown[]) => mockGetBars(...a) }))
const mockFetchDailyChart = vi.fn()
vi.mock('../historical-prices', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../historical-prices')>()),
  fetchDailyChart: (...a: unknown[]) => mockFetchDailyChart(...a),
}))

const mockHistoricalCCL = vi.fn()
vi.mock('../currency', () => ({ getHistoricalCCL: (...a: unknown[]) => mockHistoricalCCL(...a) }))

const { compareToBenchmark, fetchBenchmarkComparison } = await import('../benchmark')

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

describe('fetchBenchmarkComparison', () => {
  beforeEach(() => vi.clearAllMocks())
  const result = (bars: { date: string; close: number }[]) =>
    ({ bars, splits: [], splitsKnown: true, degraded: false, missing: false })

  it('reads the benchmark through the daily bars cache, with ten days of lead-in, never Yahoo directly', async () => {
    mockGetBars.mockResolvedValue(new Map([['SPY', result([{ date: '2024-01-02', close: 100 }, { date: '2024-01-04', close: 105 }])]]))

    const r = await fetchBenchmarkComparison('SPY', series)

    expect(mockGetBars).toHaveBeenCalledTimes(1)
    const [symbols, from, opts] = mockGetBars.mock.calls[0]
    expect(symbols).toEqual(['SPY'])
    // Today's bar moves: a cached chart stays fresh only as long as the statistics cache (5 min).
    expect(opts).toEqual({ maxAgeSec: 300 })
    expect((from as Date).toISOString().slice(0, 10)).toBe('2023-12-23')
    expect(mockFetchDailyChart).not.toHaveBeenCalled()
    expect(r).toMatchObject({ id: 'SPY', label: 'S&P 500 (SPY)' })
    expect(r!.points.map((p) => p.benchmarkPct)).toEqual([0, 0, expect.closeTo(5, 9)])
    expect(r!.excessPp).toBeCloseTo(16, 9)
  })

  it('MERVAL in USD: the cached ARS bars divided by the CCL of the day', async () => {
    mockGetBars.mockResolvedValue(new Map([['^MERV', result([
      { date: '2024-01-02', close: 1000 }, { date: '2024-01-03', close: 1100 }, { date: '2024-01-04', close: 1200 },
    ])]]))
    mockHistoricalCCL.mockResolvedValue(new Map([['2024-01-02', 1000], ['2024-01-04', 1200]]))

    const r = await fetchBenchmarkComparison('MERV_CCL', series)

    expect(mockGetBars.mock.calls[0][0]).toEqual(['^MERV'])
    expect(r!.points.map((p) => p.benchmarkPct)).toEqual([0, expect.closeTo(10, 9), 0])
  })

  it('no bars at all is still an error, which the route turns into its flag', async () => {
    mockGetBars.mockResolvedValue(new Map([['QQQ', { ...result([]), degraded: true, missing: true }]]))
    await expect(fetchBenchmarkComparison('QQQ', series)).rejects.toThrow('No benchmark data for QQQ')
  })
})
