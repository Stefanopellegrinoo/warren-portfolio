import { describe, it, expect } from 'vitest'
import { computeFlowAdjustedReturns } from '../drawdown'
import { computeReturnStats } from '../return-stats'

// ── Helpers ──────────────────────────────────────────────────────────────────

function snap(date: string, value: number) {
  return { snapshot_date: date, total_value: value }
}

// ── computeFlowAdjustedReturns ───────────────────────────────────────────────

describe('computeFlowAdjustedReturns', () => {
  it('returns the simple interval return when there are no flows', () => {
    // Arrange — 100 → 110
    const snapshots = [snap('2026-01-01', 100), snap('2026-01-02', 110)]

    // Act
    const result = computeFlowAdjustedReturns(snapshots, [])

    // Assert
    expect(result.returns).toHaveLength(1)
    expect(result.returns[0]).toBeCloseTo(0.1)
    expect(result.intervalsUsed).toBe(1)
    expect(result.intervalsSkipped).toBe(0)
  })

  it('neutralizes a deposit inside the interval — money in is not performance', () => {
    // Arrange — 100 → 150 but 40 of that was a deposit: r = (150-40)/100 - 1
    const snapshots = [snap('2026-01-01', 100), snap('2026-01-02', 150)]
    const flows = [{ date: '2026-01-02', amount: 40 }]

    // Act
    const result = computeFlowAdjustedReturns(snapshots, flows)

    // Assert
    expect(result.returns[0]).toBeCloseTo(0.1)
  })

  it('skips intervals with a non-positive base instead of poisoning the series', () => {
    // Arrange — middle snapshot is broken data (0)
    const snapshots = [
      snap('2026-01-01', 100),
      snap('2026-01-02', 0),
      snap('2026-01-03', 105),
    ]

    // Act
    const result = computeFlowAdjustedReturns(snapshots, [])

    // Assert — both intervals touching the 0 are unusable
    expect(result.intervalsSkipped).toBe(2)
    expect(result.returns).toHaveLength(0)
  })

  it('produces the same interval count the drawdown reports', () => {
    const snapshots = [
      snap('2026-01-01', 100),
      snap('2026-01-02', 110),
      snap('2026-01-03', 99),
    ]
    const result = computeFlowAdjustedReturns(snapshots, [])
    expect(result.returns).toHaveLength(2)
    expect(result.returns[1]).toBeCloseTo(99 / 110 - 1)
  })
})

// ── computeReturnStats ───────────────────────────────────────────────────────

describe('computeReturnStats', () => {
  it('annualizes volatility from daily returns with √252', () => {
    // Arrange — returns +10% / -10%: mean 0, sample std √0.02
    const returns = [0.1, -0.1]

    // Act
    const stats = computeReturnStats(returns)

    // Assert
    expect(stats.annualizedVol).toBeCloseTo(Math.sqrt(0.02) * Math.sqrt(252), 6)
    expect(stats.sharpeRatio).toBeCloseTo(0, 6)
  })

  it('annualizes Sharpe as (mean/std)·√252', () => {
    // Arrange — [1%, 3%]: mean 0.02, sample std √0.0002
    const returns = [0.01, 0.03]

    // Act
    const stats = computeReturnStats(returns)

    // Assert — 0.02/0.0141421… · 15.8745… ≈ 22.45
    expect(stats.sharpeRatio).toBeCloseTo((0.02 / Math.sqrt(0.0002)) * Math.sqrt(252), 4)
  })

  it('returns nulls with fewer than two returns — one point is not a series', () => {
    expect(computeReturnStats([]).annualizedVol).toBeNull()
    expect(computeReturnStats([0.05]).sharpeRatio).toBeNull()
  })

  it('returns vol 0 and null Sharpe when the series has no variance', () => {
    // Arrange — identical returns: std 0, Sharpe undefined (division by zero)
    const stats = computeReturnStats([0.01, 0.01, 0.01])

    // Assert
    expect(stats.annualizedVol).toBe(0)
    expect(stats.sharpeRatio).toBeNull()
  })

  it('reports how many intervals the figures rest on', () => {
    const stats = computeReturnStats([0.01, 0.02, -0.01])
    expect(stats.intervals).toBe(3)
  })
})
