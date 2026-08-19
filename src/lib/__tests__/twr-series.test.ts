import { describe, it, expect } from 'vitest'
import { computeTwrSeries } from '../twr-series'

// ── Helpers ──────────────────────────────────────────────────────────────────

function snap(date: string, total_value: number) {
  return { snapshot_date: date, total_value }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('computeTwrSeries', () => {
  it('returns an empty series with fewer than two snapshots', () => {
    // Act + Assert — one point is not a series
    expect(computeTwrSeries([], [])).toEqual({ series: [], intervalsUsed: 0, intervalsSkipped: 0 })
    expect(computeTwrSeries([snap('2026-01-01', 1000)], [])).toEqual({
      series: [], intervalsUsed: 0, intervalsSkipped: 0,
    })
  })

  it('links interval returns geometrically into a cumulative index starting at 1.0', () => {
    // Arrange — 1000 → 1100 (+10%) → 1045 (−5%); hand-computed:
    // index: 1.0 → 1.1 → 1.1 × 0.95 = 1.045 → twrPct 0, 10, 4.5
    const snapshots = [snap('2026-01-01', 1000), snap('2026-01-02', 1100), snap('2026-01-03', 1045)]

    // Act
    const { series, intervalsUsed } = computeTwrSeries(snapshots, [])

    // Assert
    expect(intervalsUsed).toBe(2)
    expect(series).toHaveLength(3) // baseline + one point per usable interval
    expect(series[0]).toEqual({ date: '2026-01-01', twrIndex: 1, twrPct: 0 })
    expect(series[1].date).toBe('2026-01-02')
    expect(series[1].twrIndex).toBeCloseTo(1.1)
    expect(series[1].twrPct).toBeCloseTo(10)
    expect(series[2].date).toBe('2026-01-03')
    expect(series[2].twrIndex).toBeCloseTo(1.045)
    expect(series[2].twrPct).toBeCloseTo(4.5)
  })

  it('neutralizes an external flow — a deposit is not performance', () => {
    // Arrange — 1000 → 2100 but 1000 was deposited:
    // r = (2100 − 1000) / 1000 − 1 = 0.1 → +10%, NOT +110%
    const snapshots = [snap('2026-01-01', 1000), snap('2026-01-02', 2100)]
    const flows = [{ date: '2026-01-02', amount: 1000 }]

    // Act
    const { series } = computeTwrSeries(snapshots, flows)

    // Assert
    expect(series[1].twrPct).toBeCloseTo(10)
  })

  it('surfaces skipped intervals as gaps — never zero-filled points', () => {
    // Arrange — 1000 → 1100 (+10%), then a broken 0 snapshot, then 900.
    // Interval 2 (factor 0) and interval 3 (zero base) are both skipped.
    const snapshots = [
      snap('2026-01-01', 1000),
      snap('2026-01-02', 1100),
      snap('2026-01-03', 0),
      snap('2026-01-04', 900),
    ]

    // Act
    const { series, intervalsUsed, intervalsSkipped } = computeTwrSeries(snapshots, [])

    // Assert — the index survives at its last honest value; no fake -100%
    expect(intervalsUsed).toBe(1)
    expect(intervalsSkipped).toBe(2)
    expect(series.map(p => p.date)).toEqual(['2026-01-01', '2026-01-02'])
    expect(series[1].twrPct).toBeCloseTo(10)
  })

  it('anchors the baseline to the first usable interval when leading intervals are skipped', () => {
    // Arrange — a broken zero opening snapshot skips the FIRST interval;
    // the baseline must NOT be dated at that skipped interval's opening.
    const snapshots = [snap('2026-01-01', 0), snap('2026-01-02', 1000), snap('2026-01-03', 1100)]

    // Act
    const { series, intervalsUsed, intervalsSkipped } = computeTwrSeries(snapshots, [])

    // Assert — baseline is 2026-01-02 (opening of the first usable interval), not 2026-01-01
    expect(intervalsUsed).toBe(1)
    expect(intervalsSkipped).toBe(1)
    expect(series).toHaveLength(2)
    expect(series[0]).toEqual({ date: '2026-01-02', twrIndex: 1, twrPct: 0 })
    expect(series[1].date).toBe('2026-01-03')
    expect(series[1].twrIndex).toBeCloseTo(1.1)
    expect(series[1].twrPct).toBeCloseTo(10)
  })

  it('sorts unordered snapshots before linking', () => {
    // Arrange — same fixture as the linking test, shuffled
    const snapshots = [snap('2026-01-03', 1045), snap('2026-01-01', 1000), snap('2026-01-02', 1100)]

    // Act
    const { series } = computeTwrSeries(snapshots, [])

    // Assert
    expect(series.map(p => p.date)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03'])
    expect(series[2].twrPct).toBeCloseTo(4.5)
  })
})
