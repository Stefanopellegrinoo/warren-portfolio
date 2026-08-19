import { describe, it, expect } from 'vitest'
import { computeFlowAdjustedMaxDrawdown, computeFlowAdjustedReturns } from '../drawdown'

function snap(date: string, total_value: number) {
  return { snapshot_date: date, total_value }
}

describe('computeFlowAdjustedMaxDrawdown', () => {
  it('returns zero with no snapshots', () => {
    expect(computeFlowAdjustedMaxDrawdown([], [])).toEqual({
      maxDrawdown: 0,
      intervalsUsed: 0,
      intervalsSkipped: 0,
    })
  })

  it('returns zero with a single snapshot — one point is not a series', () => {
    const result = computeFlowAdjustedMaxDrawdown([snap('2026-01-01', 1000)], [])
    expect(result.maxDrawdown).toBe(0)
    expect(result.intervalsUsed).toBe(0)
  })

  it('measures a plain decline when there are no flows', () => {
    // Arrange — 1000 → 800 is a 20% drawdown
    const snapshots = [snap('2026-01-01', 1000), snap('2026-01-02', 800)]

    // Act
    const result = computeFlowAdjustedMaxDrawdown(snapshots, [])

    // Assert
    expect(result.maxDrawdown).toBeCloseTo(-0.2)
    expect(result.intervalsUsed).toBe(1)
  })

  it('does NOT report a drawdown when the drop is a withdrawal', () => {
    // Arrange — value falls 1000 → 600 purely because 400 was withdrawn.
    // This is the entire point of the adjustment: the user lost nothing.
    const snapshots = [snap('2026-01-01', 1000), snap('2026-01-02', 600)]
    const flows = [{ date: '2026-01-02', amount: -400 }]

    // Act
    const result = computeFlowAdjustedMaxDrawdown(snapshots, flows)

    // Assert
    expect(result.maxDrawdown).toBe(0)
    expect(result.intervalsUsed).toBe(1)
  })

  it('does NOT let a deposit reset the peak and hide an ongoing drawdown', () => {
    // Arrange — the portfolio is already 20% down, THEN 1000 is deposited, then
    // it loses another 5%. Unadjusted, the deposit lifts the index to a new peak
    // and the earlier loss stops counting; adjusted, the losses compound.
    //   1000 → 800 (-20%) → deposit 1000 → 1800 → 1710 (-5%)
    const snapshots = [
      snap('2026-01-01', 1000),
      snap('2026-01-02', 800),
      snap('2026-01-03', 1800),
      snap('2026-01-04', 1710),
    ]
    const flows = [{ date: '2026-01-03', amount: 1000 }]

    // Act
    const result = computeFlowAdjustedMaxDrawdown(snapshots, flows)

    // Assert — 0.8 × 1.0 × 0.95 = 0.76 against a peak of 1 → -24%.
    // Ignoring the deposit would report only -20%, understating the damage.
    expect(result.maxDrawdown).toBeCloseTo(-0.24)
    expect(result.intervalsUsed).toBe(3)
  })

  it('separates a real loss that happens alongside a withdrawal', () => {
    // Arrange — withdrew 200 AND lost 10%: 1000 → (1000×0.9) - 200 = 700
    const snapshots = [snap('2026-01-01', 1000), snap('2026-01-02', 700)]
    const flows = [{ date: '2026-01-02', amount: -200 }]

    // Act
    const result = computeFlowAdjustedMaxDrawdown(snapshots, flows)

    // Assert — only the 10% market loss counts
    expect(result.maxDrawdown).toBeCloseTo(-0.1)
  })

  it('keeps the worst trough after a recovery', () => {
    // Arrange — 1000 → 700 → 950: recovered but never back above the peak
    const snapshots = [
      snap('2026-01-01', 1000),
      snap('2026-01-02', 700),
      snap('2026-01-03', 950),
    ]

    // Act
    const result = computeFlowAdjustedMaxDrawdown(snapshots, [])

    // Assert
    expect(result.maxDrawdown).toBeCloseTo(-0.3)
    expect(result.intervalsUsed).toBe(2)
  })

  it('measures the drawdown from a new peak, not the original one', () => {
    // Arrange — climbs to 2000 then falls to 1600
    const snapshots = [
      snap('2026-01-01', 1000),
      snap('2026-01-02', 2000),
      snap('2026-01-03', 1600),
    ]

    // Act
    const result = computeFlowAdjustedMaxDrawdown(snapshots, [])

    // Assert — -20% from the 2000 peak, not -60% from 1000
    expect(result.maxDrawdown).toBeCloseTo(-0.2)
  })

  it('attributes a flow on a day with no snapshot to the next interval', () => {
    // Arrange — weekend deposit: snapshots skip Sat/Sun, money lands Saturday.
    // 500 came in while the portfolio actually lost 10%: 1000 × 0.9 + 500 = 1400.
    const snapshots = [snap('2026-01-02', 1000), snap('2026-01-05', 1400)]
    const flows = [{ date: '2026-01-03', amount: 500 }]

    // Act
    const result = computeFlowAdjustedMaxDrawdown(snapshots, flows)

    // Assert — dropping the weekend flow would read as a +40% gain and hide the loss
    expect(result.maxDrawdown).toBeCloseTo(-0.1)
    expect(result.intervalsUsed).toBe(1)
  })

  it('ignores flows that predate the first snapshot', () => {
    // Arrange — the baseline value already reflects them
    const snapshots = [snap('2026-01-10', 1000), snap('2026-01-11', 900)]
    const flows = [
      { date: '2026-01-01', amount: 5000 },
      { date: '2026-01-10', amount: 300 },
    ]

    // Act
    const result = computeFlowAdjustedMaxDrawdown(snapshots, flows)

    // Assert — counting either one would make the adjusted value negative and
    // the interval would be discarded instead of yielding a clean -10%
    expect(result.maxDrawdown).toBeCloseTo(-0.1)
    expect(result.intervalsUsed).toBe(1)
    expect(result.intervalsSkipped).toBe(0)
  })

  it('sums several flows falling inside one interval', () => {
    // Arrange — deposit 300 then withdraw 100 between snapshots; net +200,
    // while the portfolio itself lost 10%: 1000 × 0.9 + 200 = 1100
    const snapshots = [snap('2026-01-01', 1000), snap('2026-01-05', 1100)]
    const flows = [
      { date: '2026-01-02', amount: 300 },
      { date: '2026-01-03', amount: -100 },
    ]

    // Act
    const result = computeFlowAdjustedMaxDrawdown(snapshots, flows)

    // Assert — netting only one of the two flows would give the wrong loss
    expect(result.maxDrawdown).toBeCloseTo(-0.1)
  })

  it('skips an interval whose starting value is not positive', () => {
    // Arrange — a user whose cash went deeply negative can hit <= 0 total value;
    // a return has no meaning off a zero or negative base
    const snapshots = [snap('2026-01-01', 0), snap('2026-01-02', 500), snap('2026-01-03', 400)]

    // Act
    const result = computeFlowAdjustedMaxDrawdown(snapshots, [])

    // Assert — first interval unusable, second is a clean -20%
    expect(result.intervalsSkipped).toBe(1)
    expect(result.intervalsUsed).toBe(1)
    expect(result.maxDrawdown).toBeCloseTo(-0.2)
  })

  it('skips an interval that would drive the index to zero or below', () => {
    // Arrange — flow-adjusted value lands at or under zero (broken data, not a
    // real -100% day). Reporting -100% forever would be worse than reporting a gap.
    const snapshots = [snap('2026-01-01', 1000), snap('2026-01-02', -50)]

    // Act
    const result = computeFlowAdjustedMaxDrawdown(snapshots, [])

    // Assert
    expect(result.intervalsSkipped).toBe(1)
    expect(result.maxDrawdown).toBe(0)
  })

  it('sorts snapshots and flows defensively instead of trusting input order', () => {
    // Arrange — same data as the withdrawal case, shuffled
    const snapshots = [snap('2026-01-02', 600), snap('2026-01-01', 1000)]
    const flows = [{ date: '2026-01-02', amount: -400 }]

    // Act
    const result = computeFlowAdjustedMaxDrawdown(snapshots, flows)

    // Assert
    expect(result.maxDrawdown).toBe(0)
    expect(result.intervalsUsed).toBe(1)
  })

  it('never returns a positive drawdown', () => {
    // Arrange — a portfolio that only ever goes up
    const snapshots = [snap('2026-01-01', 100), snap('2026-01-02', 200), snap('2026-01-03', 400)]

    // Act
    const result = computeFlowAdjustedMaxDrawdown(snapshots, [])

    // Assert
    expect(result.maxDrawdown).toBe(0)
  })

  it('handles numeric strings, which is how numeric(18,4) arrives from Postgres', () => {
    // Arrange
    const snapshots = [
      { snapshot_date: '2026-01-01', total_value: '1000.0000' as any },
      { snapshot_date: '2026-01-02', total_value: '800.0000' as any },
    ]
    const flows = [{ date: '2026-01-02', amount: '0' as any }]

    // Act
    const result = computeFlowAdjustedMaxDrawdown(snapshots, flows)

    // Assert
    expect(result.maxDrawdown).toBeCloseTo(-0.2)
  })
})

describe('computeFlowAdjustedReturns — per-interval metadata', () => {
  it('pairs each usable return with the snapshot_date closing its interval', () => {
    // Arrange — 1000 → 1100 (+10%) → 1045 (−5%)
    const snapshots = [snap('2026-01-01', 1000), snap('2026-01-02', 1100), snap('2026-01-03', 1045)]

    // Act
    const result = computeFlowAdjustedReturns(snapshots, [])

    // Assert
    expect(result.intervals).toHaveLength(2)
    expect(result.intervals[0].endDate).toBe('2026-01-02')
    expect(result.intervals[0].r).toBeCloseTo(0.1)
    expect(result.intervals[1].endDate).toBe('2026-01-03')
    expect(result.intervals[1].r).toBeCloseTo(-0.05)
  })

  it('surfaces a skipped interval as r: null under its end date — never zero-filled', () => {
    // Arrange — the middle snapshot is a broken 0: both adjacent intervals
    // are unusable (factor 0, then a zero base)
    const snapshots = [snap('2026-01-01', 1000), snap('2026-01-02', 0), snap('2026-01-03', 500)]

    // Act
    const result = computeFlowAdjustedReturns(snapshots, [])

    // Assert
    expect(result.intervals).toEqual([
      { endDate: '2026-01-02', r: null },
      { endDate: '2026-01-03', r: null },
    ])
    expect(result.returns).toEqual([])
    expect(result.intervalsSkipped).toBe(2)
  })

  it('returns empty metadata with fewer than two snapshots', () => {
    // Act + Assert
    expect(computeFlowAdjustedReturns([snap('2026-01-01', 1000)], []).intervals).toEqual([])
    expect(computeFlowAdjustedReturns([], []).intervals).toEqual([])
  })
})

describe('computeFlowAdjustedReturns — unmeasurableDates', () => {
  it('reports the interval containing an unmeasurable date as a gap, not a return', () => {
    // Arrange — a clean +10% that the caller declares it cannot interpret.
    const snapshots = [snap('2026-01-01', 1000), snap('2026-01-02', 1100), snap('2026-01-03', 1100)]

    // Act
    const result = computeFlowAdjustedReturns(snapshots, [], {
      unmeasurableDates: ['2026-01-02'],
    })

    // Assert — the move is dropped, not zero-filled and not counted.
    expect(result.intervals[0]).toEqual({ endDate: '2026-01-02', r: null })
    expect(result.returns).toEqual([0])
    expect(result.intervalsUsed).toBe(1)
    expect(result.intervalsSkipped).toBe(1)
  })

  it('skips the interval that CONTAINS the date, not the one that starts on it', () => {
    // Arrange — a Saturday date with no snapshot of its own: Friday 01-02 to
    // Monday 01-05 is the interval that spans it. Anchoring on the boundary
    // alone would skip the wrong one and leave the real gap measured.
    const snapshots = [
      snap('2026-01-01', 1000),
      snap('2026-01-02', 1000),
      snap('2026-01-05', 1200),
      snap('2026-01-06', 1200),
    ]

    // Act
    const result = computeFlowAdjustedReturns(snapshots, [], {
      unmeasurableDates: ['2026-01-03'],
    })

    // Assert
    expect(result.intervals).toEqual([
      { endDate: '2026-01-02', r: 0 },
      { endDate: '2026-01-05', r: null },
      { endDate: '2026-01-06', r: 0 },
    ])
    expect(result.intervalsSkipped).toBe(1)
  })

  it('ignores a date at or before the baseline — it closes no interval', () => {
    // Arrange
    const snapshots = [snap('2026-01-01', 1000), snap('2026-01-02', 1100)]

    // Act
    const result = computeFlowAdjustedReturns(snapshots, [], {
      unmeasurableDates: ['2025-12-30', '2026-01-01'],
    })

    // Assert — nothing was skipped; the +10% still counts.
    expect(result.returns).toHaveLength(1)
    expect(result.returns[0]).toBeCloseTo(0.1)
    expect(result.intervalsSkipped).toBe(0)
  })

  it('changes nothing when the option is absent or empty', () => {
    const snapshots = [snap('2026-01-01', 1000), snap('2026-01-02', 1100)]

    expect(computeFlowAdjustedReturns(snapshots, [], { unmeasurableDates: [] })).toEqual(
      computeFlowAdjustedReturns(snapshots, [])
    )
  })

  it('drops the flows of a skipped interval with it — they do not leak forward', () => {
    // Arrange — 1000 → 1000 with a +500 deposit inside the skipped interval,
    // then a flat day. If the deposit leaked into the next interval its
    // factor would be (1000-500)/1000 = a fabricated −50%.
    const snapshots = [snap('2026-01-01', 1000), snap('2026-01-02', 1000), snap('2026-01-03', 1000)]

    // Act
    const result = computeFlowAdjustedReturns(
      snapshots,
      [{ date: '2026-01-02', amount: 500 }],
      { unmeasurableDates: ['2026-01-02'] }
    )

    // Assert
    expect(result.returns).toEqual([0])
    expect(result.intervalsSkipped).toBe(1)
  })

  it('computeFlowAdjustedMaxDrawdown forwards the option', () => {
    // Arrange — a −20% that the caller declares unmeasurable, then a real −10%.
    const snapshots = [
      snap('2026-01-01', 1000),
      snap('2026-01-02', 800),
      snap('2026-01-03', 720),
    ]

    // Act
    const result = computeFlowAdjustedMaxDrawdown(snapshots, [], {
      unmeasurableDates: ['2026-01-02'],
    })

    // Assert — only the measured −10% reaches the drawdown.
    expect(result.maxDrawdown).toBeCloseTo(-0.1)
    expect(result.intervalsUsed).toBe(1)
    expect(result.intervalsSkipped).toBe(1)
  })
})
