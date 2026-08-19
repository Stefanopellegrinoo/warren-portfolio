/**
 * Rules for filling the per-asset-class breakdown on snapshot rows that already
 * exist.
 *
 * Those rows hold totals that are already correct — measured ones especially,
 * priced against quotes that no longer exist. Nothing here may change a total.
 * Two rules decide what is allowed:
 *
 *  1. matchesStoredTotals — for a RECONSTRUCTED row, the replay must reproduce
 *     the stored totals before its breakdown is trusted. A replay that cannot
 *     reproduce the total has no business asserting what the total was made of.
 *
 *  2. deriveMeasuredBreakdown — for a MEASURED row, the total must be preserved
 *     as-is. Cash replays exactly and stocks recompute from historical closes,
 *     so the ON leg is derived by difference: the sum invariant then holds by
 *     construction, and any recomputation error lands in the one class that has
 *     no honest history anyway. Bounded by two guards: a cost-basis check that
 *     the derived ons_invested agrees with the replayed onsInvested (both
 *     describe the same holdings), and a P&L-ratio check computed on the
 *     PERSISTED pair (ons_value, derived ons_invested) — not the replayed
 *     input, which can diverge from what actually gets written.
 *
 * WORKER-SAFE: no imports.
 */

export interface StoredTotals {
  total_value: number
  total_invested: number
  pnl: number
  pnl_pct: number
}

export interface Breakdown {
  stocks_value: number
  stocks_invested: number
  ons_value: number
  ons_invested: number
  cash_value: number
}

/** Postgres stores numeric(18,4); a cent of drift is arithmetic, not corruption. */
export const TOTALS_TOLERANCE = 0.01

/**
 * Max |implied ON P&L| / ons_invested a derivation may attribute to the bonds.
 *
 * CALIBRATED, NOT GUESSED: on 2026-07-23 this portfolio's ONs moved from
 * 185,613.00 of cost to 199,334.00 of market — +7.4%. A ±5% band would have
 * aborted the fill on day one. 0.25 admits a plausible bond move while still
 * catching a gross recomputation error, which is what the guard is for.
 */
export const ON_PNL_GUARD = 0.25

/**
 * Max |derived ons_invested − replayed onsInvested|, in dollars.
 *
 * Same order as this repo's existing INVESTED_TOLERANCE (backfill-gate.ts):
 * Postgres stores numeric(18,4) and rounds avg_cost on every write, so a long
 * buy history accumulates cents of drift. Beyond that, a divergence means the
 * stock leg did not recompute correctly — the two numbers describe the SAME
 * holdings and are only guaranteed to agree when stocksInvested recomputed
 * perfectly, which is exactly what this check exists to detect.
 */
export const ON_INVESTED_TOLERANCE = 1.0

function finite(value: number): boolean {
  return Number.isFinite(value)
}

/** Does a recomputation reproduce the row already stored? */
export function matchesStoredTotals(
  computed: StoredTotals,
  stored: StoredTotals
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  const fields: Array<keyof StoredTotals> = ['total_value', 'total_invested', 'pnl', 'pnl_pct']

  for (const field of fields) {
    const a = computed[field]
    const b = stored[field]

    // A non-finite operand makes `Math.abs(a - b) > tol` evaluate to false,
    // which reads as "no discrepancy" and lets the row through. That false PASS
    // is the one failure direction this check must never have.
    if (!finite(a) || !finite(b)) {
      reasons.push(`${field}: non-numeric operand (computed ${String(a)}, stored ${String(b)})`)
      continue
    }

    if (Math.abs(a - b) > TOTALS_TOLERANCE) {
      reasons.push(`${field}: recomputed ${a.toFixed(4)} vs stored ${b.toFixed(4)}`)
    }
  }

  return { ok: reasons.length === 0, reasons }
}

/**
 * Breakdown for a MEASURED row, preserving its stored totals exactly.
 *
 * The ON legs are derived by difference, so both invariants hold by
 * construction rather than by luck.
 */
export function deriveMeasuredBreakdown(input: {
  stored: StoredTotals
  stocksValue: number
  stocksInvested: number
  cashValue: number
  onsInvested: number
}): { ok: true; breakdown: Breakdown } | { ok: false; reason: string } {
  const { stored, stocksValue, stocksInvested, cashValue, onsInvested } = input

  const operands: Array<[string, number]> = [
    ['stored.total_value', stored.total_value],
    ['stored.total_invested', stored.total_invested],
    ['stocksValue', stocksValue],
    ['stocksInvested', stocksInvested],
    ['cashValue', cashValue],
    ['onsInvested', onsInvested],
  ]
  const bad = operands.filter(([, v]) => !finite(v)).map(([name]) => name)
  if (bad.length > 0) {
    return { ok: false, reason: `non-numeric operand(s): ${bad.join(', ')}` }
  }

  const onsValue = stored.total_value - stocksValue - cashValue
  const onsInvestedDerived = stored.total_invested - stocksInvested

  if (onsValue < 0) {
    return { ok: false, reason: `derived ons_value is negative (${onsValue.toFixed(2)})` }
  }

  if (onsInvestedDerived < 0) {
    return { ok: false, reason: `derived ons_invested is negative (${onsInvestedDerived.toFixed(2)})` }
  }

  // onsInvestedDerived (what gets WRITTEN as ons_invested) and onsInvested (the
  // replayed input) describe the SAME holdings and must agree to within
  // rounding. They are only guaranteed equal when stocksInvested recomputed
  // perfectly — which is exactly what this check exists to detect. A material
  // divergence names a broken stock leg far more precisely than the P&L guard
  // below ever could, because that guard only sees the symptom on the ON side.
  if (Math.abs(onsInvestedDerived - onsInvested) > ON_INVESTED_TOLERANCE) {
    return {
      ok: false,
      reason:
        `cost-basis mismatch: derived ons_invested ${onsInvestedDerived.toFixed(2)} (stored ` +
        `total_invested ${stored.total_invested.toFixed(2)} minus stocksInvested ${stocksInvested.toFixed(2)}) ` +
        `vs replayed onsInvested ${onsInvested.toFixed(2)} — differ by more than ` +
        `${ON_INVESTED_TOLERANCE.toFixed(2)}, the stock leg did not recompute correctly`,
    }
  }

  // With no ON holdings there is nothing to guard: the derived value should be
  // ~0 and the ratio would divide by zero.
  //
  // Computed from the PERSISTED pair (onsValue, onsInvestedDerived) — the pair
  // that actually gets WRITTEN — not the replayed onsInvested input. The cost-
  // basis check above is what makes this substitution safe: once the two are
  // known to agree within tolerance, guarding on either yields the same
  // verdict, but only the persisted pair is what a reader of the row will ever
  // see. Guarding on the input alone (the previous behaviour) let a broken
  // stocksInvested recomputation slip a wildly wrong (derived-value,
  // replayed-cost) ratio past the guard while the row itself carried a
  // different, unchecked pair.
  if (onsInvestedDerived > 0) {
    const impliedPnl = onsValue - onsInvestedDerived
    const ratio = Math.abs(impliedPnl) / onsInvestedDerived
    if (ratio > ON_PNL_GUARD) {
      return {
        ok: false,
        reason:
          `guard: implied ON P&L ${impliedPnl.toFixed(2)} on persisted ons_invested ` +
          `${onsInvestedDerived.toFixed(2)} (ons_value ${onsValue.toFixed(2)}) is ` +
          `${(ratio * 100).toFixed(1)}% — beyond the ${(ON_PNL_GUARD * 100).toFixed(0)}% band, ` +
          `this is a recomputation error, not a bond move`,
      }
    }
  }

  return {
    ok: true,
    breakdown: {
      stocks_value: stocksValue,
      stocks_invested: stocksInvested,
      ons_value: onsValue,
      ons_invested: onsInvestedDerived,
      cash_value: cashValue,
    },
  }
}
