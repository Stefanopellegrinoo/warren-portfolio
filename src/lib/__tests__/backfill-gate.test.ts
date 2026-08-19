// src/lib/__tests__/backfill-gate.test.ts
import { describe, it, expect } from 'vitest'
import { reconcileUser } from '../backfill-gate'
import type { ReplayState } from '../portfolio-replay'

function state(over: Partial<ReplayState> = {}): ReplayState {
  return { positions: [], onPositions: [], cashBalance: 0, ...over }
}

const pos = (ticker: string, quantity: number, total_invested: number) => ({
  ticker,
  quantity,
  avg_cost: quantity > 0 ? total_invested / quantity : 0,
  total_invested,
})

describe('reconcileUser', () => {
  it('passes when replay matches storage exactly', () => {
    const result = reconcileUser(
      state({ positions: [pos('AAPL', 10, 1000)], cashBalance: 500 }),
      { positions: [{ ticker: 'AAPL', quantity: 10, total_invested: 1000 }], onPositions: [], cashBalance: 500 }
    )

    expect(result.ok).toBe(true)
    expect(result.reasons).toEqual([])
  })

  it('tolerates sub-dollar invested drift from numeric(18,4) rounding', () => {
    // AMZN: the DB rounds avg_cost on every write, so a long history of buys
    // accumulates ~$0.30 of drift. That is arithmetic, not corruption.
    const result = reconcileUser(
      state({ positions: [pos('AMZN', 10, 1000.3)], cashBalance: 0 }),
      { positions: [{ ticker: 'AMZN', quantity: 10, total_invested: 1000 }], onPositions: [], cashBalance: 0 }
    )

    expect(result.ok).toBe(true)
  })

  it('rejects an invested gap larger than the rounding tolerance', () => {
    const result = reconcileUser(
      state({ positions: [pos('AAPL', 10, 1500)], cashBalance: 0 }),
      { positions: [{ ticker: 'AAPL', quantity: 10, total_invested: 1000 }], onPositions: [], cashBalance: 0 }
    )

    expect(result.ok).toBe(false)
    expect(result.reasons.join(' ')).toMatch(/AAPL/)
  })

  it('ignores a dust position the DB already closed', () => {
    // VIST leaves 0.0033 shares worth $0.15.
    const result = reconcileUser(
      state({ positions: [pos('VIST', 0.0033, 0.15)], cashBalance: 0 }),
      { positions: [], onPositions: [], cashBalance: 0 }
    )

    expect(result.ok).toBe(true)
  })

  it('rejects a stored position with no transactions behind it', () => {
    // 94b2edc8 has 8 of these — seed rows. Backfilling that account would
    // invent a history that never happened.
    const result = reconcileUser(
      state({ positions: [], cashBalance: 0 }),
      { positions: [{ ticker: 'GHOST', quantity: 5, total_invested: 500 }], onPositions: [], cashBalance: 0 }
    )

    expect(result.ok).toBe(false)
    expect(result.reasons.join(' ')).toMatch(/GHOST/)
  })

  it('rejects a cash gap beyond a cent', () => {
    const result = reconcileUser(state({ cashBalance: 1000 }), {
      positions: [],
      onPositions: [],
      cashBalance: 1000 - 9093,
    })

    expect(result.ok).toBe(false)
    expect(result.reasons.join(' ')).toMatch(/cash/i)
  })

  it('accepts a cash difference within a cent', () => {
    const result = reconcileUser(state({ cashBalance: 1000.004 }), {
      positions: [],
      onPositions: [],
      cashBalance: 1000,
    })

    expect(result.ok).toBe(true)
  })

  it('rejects a quantity mismatch beyond dust', () => {
    const result = reconcileUser(
      state({ positions: [pos('AAPL', 10, 1000)] }),
      { positions: [{ ticker: 'AAPL', quantity: 12, total_invested: 1000 }], onPositions: [], cashBalance: 0 }
    )

    expect(result.ok).toBe(false)
  })

  it('reconciles ON positions too, not only stocks', () => {
    const result = reconcileUser(
      state({ onPositions: [pos('MGCRD', 100, 9500)] }),
      { positions: [], onPositions: [{ ticker: 'MGCRD', quantity: 100, total_invested: 8000 }], cashBalance: 0 }
    )

    expect(result.ok).toBe(false)
    expect(result.reasons.join(' ')).toMatch(/MGCRD/)
  })

  it('collects every reason rather than stopping at the first', () => {
    const result = reconcileUser(
      state({ positions: [pos('AAPL', 10, 1500)], cashBalance: 1 }),
      { positions: [{ ticker: 'AAPL', quantity: 10, total_invested: 1000 }], onPositions: [], cashBalance: 500 }
    )

    expect(result.reasons.length).toBeGreaterThanOrEqual(2)
  })

  it('REFUSES a stored position with a non-numeric invested amount', () => {
    // Math.abs(NaN) > tolerance is false, so without an explicit guard this
    // reads as "no discrepancy" and the user is backfilled from unreadable
    // numbers. A false pass is far worse here than a false skip.
    const result = reconcileUser(
      state({ positions: [pos('AAPL', 10, 1000)] }),
      {
        positions: [{ ticker: 'AAPL', quantity: 10, total_invested: undefined as unknown as number }],
        onPositions: [],
        cashBalance: 0,
      }
    )

    expect(result.ok).toBe(false)
    expect(result.reasons.join(' ')).toMatch(/non-numeric/)
  })

  it('REFUSES a stored position with a non-numeric quantity', () => {
    const result = reconcileUser(
      state({ positions: [pos('AAPL', 10, 1000)] }),
      {
        positions: [{ ticker: 'AAPL', quantity: NaN, total_invested: 1000 }],
        onPositions: [],
        cashBalance: 0,
      }
    )

    expect(result.ok).toBe(false)
  })

  it('REFUSES a non-numeric cash balance', () => {
    const result = reconcileUser(state({ cashBalance: 100 }), {
      positions: [],
      onPositions: [],
      cashBalance: undefined as unknown as number,
    })

    expect(result.ok).toBe(false)
    expect(result.reasons.join(' ')).toMatch(/non-numeric/)
  })

  it('forgives a DB row the replay closed but the RPC left at zero', () => {
    // process_transaction_atomic only upserts, so a VENTA that zeroes a
    // position can leave the row behind. Rejecting it would skip every user
    // who ever closed a position through the RPC.
    const result = reconcileUser(state({ positions: [] }), {
      positions: [{ ticker: 'SOLD', quantity: 0, total_invested: 0 }],
      onPositions: [],
      cashBalance: 0,
    })

    expect(result.ok).toBe(true)
  })

  it('still rejects a zero-quantity row that carries real cost', () => {
    const result = reconcileUser(state({ positions: [] }), {
      positions: [{ ticker: 'WEIRD', quantity: 0, total_invested: 5000 }],
      onPositions: [],
      cashBalance: 0,
    })

    expect(result.ok).toBe(false)
  })

  it('forgives a closed remnant in the ON collection too', () => {
    const result = reconcileUser(state({ onPositions: [] }), {
      positions: [],
      onPositions: [{ ticker: 'MGCRD', quantity: 0, total_invested: 0 }],
      cashBalance: 0,
    })

    expect(result.ok).toBe(true)
  })
})
