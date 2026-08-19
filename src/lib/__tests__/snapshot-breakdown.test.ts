import { describe, it, expect } from 'vitest'
import { matchesStoredTotals, deriveMeasuredBreakdown } from '../snapshot-breakdown'

const stored = { total_value: 1000, total_invested: 900, pnl: 100, pnl_pct: 0.1111 }

describe('matchesStoredTotals', () => {
  it('passes when the recomputation reproduces the stored row', () => {
    expect(matchesStoredTotals({ ...stored }, stored).ok).toBe(true)
  })

  it('tolerates sub-cent drift from numeric(18,4) rounding', () => {
    expect(matchesStoredTotals({ ...stored, total_value: 1000.004 }, stored).ok).toBe(true)
  })

  it('REFUSES a total that does not reproduce — the row must not be touched', () => {
    // This is the whole point: if the replay cannot reproduce the stored total,
    // it has no business asserting what that total was made of.
    const result = matchesStoredTotals({ ...stored, total_value: 1100 }, stored)

    expect(result.ok).toBe(false)
    expect(result.reasons.join(' ')).toMatch(/total_value/)
  })

  it('checks every one of the four totals, not just the value', () => {
    expect(matchesStoredTotals({ ...stored, total_invested: 800 }, stored).ok).toBe(false)
    expect(matchesStoredTotals({ ...stored, pnl: 50 }, stored).ok).toBe(false)
    expect(matchesStoredTotals({ ...stored, pnl_pct: 0.5 }, stored).ok).toBe(false)
  })

  it('REFUSES a non-finite operand instead of letting it pass silently', () => {
    // Math.abs(NaN) > tol is false, which reads as "no discrepancy" — a false
    // PASS is the one failure direction this check must never have.
    const result = matchesStoredTotals({ ...stored, total_value: NaN }, stored)

    expect(result.ok).toBe(false)
    expect(result.reasons.join(' ')).toMatch(/non-numeric/i)
  })

  it('collects every failing total rather than stopping at the first', () => {
    const result = matchesStoredTotals({ total_value: 1, total_invested: 2, pnl: 3, pnl_pct: 4 }, stored)

    expect(result.reasons.length).toBe(4)
  })
})

describe('deriveMeasuredBreakdown', () => {
  // A measured row: its total_value came from quotes that no longer exist and
  // must never be recomputed. stocks and cash are replayable exactly; the ON
  // leg is derived by difference so the sum invariant holds by construction.
  //
  // NOTE on this fixture: stocksInvested (150102.14) + onsInvested (185613.0)
  // = total_invested (335715.14) EXACTLY, so the derived ons_invested
  // (335715.14 - 150102.14 = 185613.00) equals the replayed onsInvested in
  // every test below that reuses `base` unmodified. That is why the guard
  // ratios in those tests are identical whether computed from the persisted
  // pair or the replayed input — the cost-basis check the guard now runs
  // first has nothing to catch here by construction. The case where the two
  // diverge is tested separately below ('REFUSES a cost-basis mismatch...').
  const base = {
    stored: { total_value: 412182.39, total_invested: 335715.14, pnl: 76467.25, pnl_pct: 0.2278 },
    stocksValue: 149578.82,
    stocksInvested: 150102.14,
    cashValue: 63269.57,
    onsInvested: 185613.0,
  }

  it('derives the ON leg by difference so the parts sum to the stored total exactly', () => {
    const result = deriveMeasuredBreakdown(base)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const b = result.breakdown
    expect(b.stocks_value + b.ons_value + b.cash_value).toBeCloseTo(base.stored.total_value, 6)
    expect(b.ons_value).toBeCloseTo(412182.39 - 149578.82 - 63269.57, 6)
  })

  it('keeps the invested invariant by deriving ons_invested from the stored total', () => {
    const result = deriveMeasuredBreakdown(base)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.breakdown.stocks_invested + result.breakdown.ons_invested)
      .toBeCloseTo(base.stored.total_invested, 6)
  })

  it('ACCEPTS the real +7.4% ON move measured on 2026-07-23', () => {
    // Calibration anchor: ONs went from 185,613.00 of cost to 199,334.00 of
    // market. A tighter guard would have aborted the fill on day one.
    const result = deriveMeasuredBreakdown({
      ...base,
      stored: { ...base.stored, total_value: 149578.82 + 199334.0 + 63269.57 },
    })

    expect(result.ok).toBe(true)
  })

  it('ACCEPTS an ON P&L at the guard boundary (ratio ≈ 0.24)', () => {
    // Derived from base: onsInvested = 185613.00, impliedPnl = 44547.12 (ratio 0.24)
    // ons_value = 185613 + 44547.12 = 230160.12
    // total_value = 149578.82 + 63269.57 + 230160.12 = 443008.51
    const result = deriveMeasuredBreakdown({
      ...base,
      stored: {
        ...base.stored,
        total_value: 443008.51,
        total_invested: 335715.14,
        pnl: 107293.37,
        pnl_pct: 0.3197,
      },
    })

    expect(result.ok).toBe(true)
  })

  it('REFUSES an ON P&L just beyond the guard boundary (ratio ≈ 0.26)', () => {
    // Derived from base: onsInvested = 185613.00, impliedPnl = 48259.38 (ratio 0.26)
    // ons_value = 185613 + 48259.38 = 233872.38
    // total_value = 149578.82 + 63269.57 + 233872.38 = 446720.77
    const result = deriveMeasuredBreakdown({
      ...base,
      stored: {
        ...base.stored,
        total_value: 446720.77,
        total_invested: 335715.14,
        pnl: 111005.63,
        pnl_pct: 0.3306,
      },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/guard|implied/i)
  })

  it('REFUSES an implied ON P&L beyond the guard — that is a recomputation error, not a bond move', () => {
    // Push the stored total far above what stocks+cash+ON-cost can explain.
    const result = deriveMeasuredBreakdown({
      ...base,
      stored: { ...base.stored, total_value: base.stored.total_value + 120000 },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/guard|implied/i)
  })

  it('REFUSES a negative derived ON value outright', () => {
    const result = deriveMeasuredBreakdown({
      ...base,
      stored: { ...base.stored, total_value: 100000 },
    })

    expect(result.ok).toBe(false)
  })

  it('REFUSES a negative derived ons_invested when stocksInvested exceeds total_invested', () => {
    // This test is constructed to pass the onsValue guard (onsValue >= 0) and
    // the ON P&L guard (ratio < 0.25) but fail on negative onsInvestedDerived.
    // stocksInvested (350000) > stored.total_invested (300000) yields onsInvestedDerived = -50000
    const result = deriveMeasuredBreakdown({
      stored: { total_value: 300000, total_invested: 300000, pnl: 0, pnl_pct: 0 },
      stocksValue: 200000,
      stocksInvested: 350000,
      cashValue: 100000,
      onsInvested: 0,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/ons_invested|negative/i)
  })

  it('REFUSES a cost-basis mismatch even when the P&L ratio looks fine — this would have PASSED before the fix', () => {
    // stocksInvested moved from base's 150102.14 to 150000.00, so the derived
    // ons_invested (total_invested 335715.14 - stocksInvested 150000.00 =
    // 185715.14) no longer equals the replayed onsInvested (185613.00) — a
    // 102.14 divergence, far beyond the 1.00 tolerance.
    //
    // total_value is chosen so the derived ons_value (185715.14) equals the
    // derived ons_invested exactly, i.e. implied P&L ~0% against the
    // PERSISTED pair — the new guard. Computed the OLD way (ratio against the
    // replayed onsInvested input), it is |185715.14 - 185613.00| / 185613.00
    // ≈ 0.055%, also nowhere near the 25% band. So under the pre-fix code
    // (P&L guard only, denominator = replayed input) this row would have been
    // ACCEPTED and its broken stock leg silently written — exactly the I2 gap.
    const result = deriveMeasuredBreakdown({
      stored: { total_value: 398563.53, total_invested: 335715.14, pnl: 76467.25, pnl_pct: 0.2278 },
      stocksValue: 149578.82,
      stocksInvested: 150000.0,
      cashValue: 63269.57,
      onsInvested: 185613.0,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/cost-basis|mismatch/i)
  })

  it('REFUSES a non-finite input instead of writing NaN into the database', () => {
    const result = deriveMeasuredBreakdown({ ...base, stocksValue: NaN })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/non-numeric/i)
  })

  it('handles a portfolio with no ONs at all — nothing to derive, guard not applied', () => {
    const result = deriveMeasuredBreakdown({
      stored: { total_value: 1000, total_invested: 900, pnl: 100, pnl_pct: 0.1111 },
      stocksValue: 700,
      stocksInvested: 900,
      cashValue: 300,
      onsInvested: 0,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.breakdown.ons_value).toBeCloseTo(0, 6)
    expect(result.breakdown.ons_invested).toBeCloseTo(0, 6)
  })
})
