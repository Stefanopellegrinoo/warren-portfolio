/**
 * Per-user gate for the snapshot backfill.
 *
 * A user is backfilled only when replaying their transactions reproduces the
 * state the app actually stores. If the replay cannot reproduce TODAY, it has
 * no business asserting what any day in 2022 looked like.
 *
 * The tolerances are measured, not guessed:
 *  - INVESTED_TOLERANCE — Postgres stores numeric(18,4) and rounds avg_cost on
 *    every write, so a long buy history accumulates cents (~$0.30 on AMZN).
 *  - QUANTITY_DUST — a sale can leave a fractional remainder the DB already
 *    closed (VIST: 0.0033 shares, $0.15).
 *  - CASH_TOLERANCE — cash reconciles to the cent for all three real users.
 *
 * WORKER-SAFE: type-only imports.
 */
import type { ReplayState } from './portfolio-replay'

export const INVESTED_TOLERANCE = 1.0
export const QUANTITY_DUST = 0.01
export const CASH_TOLERANCE = 0.01

export interface StoredPosition {
  ticker: string
  quantity: number
  total_invested: number
}

export interface GateResult {
  ok: boolean
  reasons: string[]
}

interface StoredState {
  positions: StoredPosition[]
  onPositions: StoredPosition[]
  cashBalance: number
}

function indexByTicker(rows: Array<{ ticker: string; quantity: number; total_invested: number }>) {
  const map = new Map<string, { quantity: number; total_invested: number }>()
  for (const row of rows) {
    map.set(String(row.ticker).toUpperCase().trim(), {
      quantity: Number(row.quantity),
      total_invested: Number(row.total_invested),
    })
  }
  return map
}

function comparePositions(
  label: string,
  replayed: Array<{ ticker: string; quantity: number; total_invested: number }>,
  stored: StoredPosition[],
  reasons: string[]
) {
  const replayedMap = indexByTicker(replayed)
  const storedMap = indexByTicker(stored)
  const tickers = new Set([...Array.from(replayedMap.keys()), ...Array.from(storedMap.keys())])

  tickers.forEach(ticker => {
    const r = replayedMap.get(ticker)
    const s = storedMap.get(ticker)

    // A non-finite operand makes EVERY `Math.abs(a - b) > tol` below evaluate
    // to false, which reads as "no discrepancy" and lets the user through the
    // gate. That is a false PASS — the one failure direction this gate must
    // never have, since it would reconstruct a history from numbers nobody can
    // read. Refuse explicitly instead.
    const operands: Array<[string, number]> = [
      ...(r ? ([['replayed quantity', r.quantity], ['replayed invested', r.total_invested]] as Array<[string, number]>) : []),
      ...(s ? ([['stored quantity', s.quantity], ['stored invested', s.total_invested]] as Array<[string, number]>) : []),
    ]
    const nonFinite = operands.filter(([, value]) => !Number.isFinite(value))
    if (nonFinite.length > 0) {
      reasons.push(
        `${label} ${ticker}: non-numeric ${nonFinite.map(([name]) => name).join(', ')} — refusing to reconcile`
      )
      return
    }

    if (!s) {
      // Replay holds it, the DB does not. Dust the DB already closed is fine.
      if (r && r.quantity > QUANTITY_DUST) {
        reasons.push(`${label} ${ticker}: replay holds ${r.quantity} but the DB has no position`)
      }
      return
    }

    if (!r) {
      // The replay drops a position at or below dust, but the DB does not
      // always delete one: `process_transaction_atomic` only upserts, so a
      // VENTA that zeroes a position can leave a row behind (only the rebuild
      // path deletes — portfolio-engine.ts:437-438). Rejecting those would skip
      // every user who ever closed a position through the RPC, and the gate
      // would admit nobody. A row with no quantity AND no cost cannot
      // contribute a cent to any reconstructed snapshot, so forgiving it
      // invents nothing — anything larger is still a ghost and still fails.
      // (Measured 2026-07-28: zero such rows exist today. This is a guard
      // against a silent future skip, not a fix for a live symptom.)
      const isClosedRemnant =
        Math.abs(s.quantity) <= QUANTITY_DUST && Math.abs(s.total_invested) <= INVESTED_TOLERANCE
      if (!isClosedRemnant) {
        reasons.push(`${label} ${ticker}: the DB holds ${s.quantity} with no transactions behind it`)
      }
      return
    }

    if (Math.abs(r.quantity - s.quantity) > QUANTITY_DUST) {
      reasons.push(`${label} ${ticker}: quantity ${r.quantity} replayed vs ${s.quantity} stored`)
    }

    if (Math.abs(r.total_invested - s.total_invested) > INVESTED_TOLERANCE) {
      reasons.push(
        `${label} ${ticker}: invested ${r.total_invested.toFixed(4)} replayed vs ${s.total_invested.toFixed(4)} stored`
      )
    }
  })
}

/** Does replaying this user's history reproduce what the app stores today? */
export function reconcileUser(replayed: ReplayState, stored: StoredState): GateResult {
  const reasons: string[] = []

  comparePositions('stock', replayed.positions, stored.positions, reasons)
  comparePositions('ON', replayed.onPositions, stored.onPositions, reasons)

  if (!Number.isFinite(replayed.cashBalance) || !Number.isFinite(stored.cashBalance)) {
    // Same false-pass hazard as above: NaN loses every comparison silently.
    reasons.push(
      `cash: non-numeric balance (replayed ${String(replayed.cashBalance)}, stored ${String(stored.cashBalance)}) — refusing to reconcile`
    )
  } else if (Math.abs(replayed.cashBalance - stored.cashBalance) > CASH_TOLERANCE) {
    reasons.push(
      `cash: ${replayed.cashBalance.toFixed(2)} replayed vs ${stored.cashBalance.toFixed(2)} stored`
    )
  }

  return { ok: reasons.length === 0, reasons }
}
