/**
 * Reconstructs portfolio state as of a given day.
 *
 * Each day is replayed from zero: filter every transaction dated <= D and run
 * it through calculateRunningAvgCost — the SAME engine the live app and the
 * atomic RPC use. An incremental mutable walk was rejected because one bad day
 * would corrupt every day after it, with nothing to detect the corruption.
 *
 * This module does NOT value anything. It produces the state; buildSnapshotRow
 * values it, exactly as the live snapshot job does.
 *
 * WORKER-SAFE: relative value imports only.
 */
import { calculateRunningAvgCost } from './portfolio-engine'
import { cashDelta } from './cash-signs'
import type { Operation } from '@/types'

export interface ReplayTransaction {
  ticker: string
  operation: string
  quantity: number
  price: number
  commission: number | null
  /** YYYY-MM-DD, possibly with a timestamp suffix. */
  date: string
  /** ACCION | CEDEAR | ON. Absent is treated as a stock. */
  asset_type: string | null
  /**
   * Insertion timestamp — the only intra-day ordering signal that exists.
   * `transactions.date` is a plain `date` (migration 001), so same-day rows
   * cannot be ordered by it. Measured on 2026-07-28: 44 distinct values across
   * 167 rows, because the bulk import wrote each batch with one timestamp — so
   * this DISCRIMINATES for app-created rows and TIES for imported ones. The
   * operation tiebreak below covers the tie.
   */
  created_at: string | null
}

export interface ReplayMovement {
  type: string
  amount: number
  date: string
}

export interface ReplayedPosition {
  ticker: string
  quantity: number
  avg_cost: number
  total_invested: number
}

export interface ReplayState {
  positions: ReplayedPosition[]
  onPositions: ReplayedPosition[]
  cashBalance: number
}

/** A stored date may carry a timestamp; the comparison is on the day only. */
function dayOf(date: string): string {
  return String(date).slice(0, 10)
}

/**
 * Position state as of `date`.
 *
 * `total_invested` IS the costBasis of calculateRunningAvgCost — the same
 * quantity the RPC writes to positions.total_invested.
 */
export function replayPortfolioAt(
  transactions: ReplayTransaction[],
  movements: ReplayMovement[],
  date: string
): ReplayState {
  const cutoff = dayOf(date)

  const byTicker = new Map<string, { assetType: string; txs: ReplayTransaction[] }>()

  for (const tx of transactions) {
    if (dayOf(tx.date) > cutoff) continue

    // Normalize the key: 'aapl' and 'AAPL' must be the same position, not two
    // independent partial cost bases.
    const key = String(tx.ticker).trim().toUpperCase()

    const entry = byTicker.get(key) ?? {
      assetType: String(tx.asset_type ?? '').toUpperCase(),
      txs: [],
    }
    // Route by asset_type, NEVER by the D suffix: AMD, FORD and JD end in D
    // and are stocks. A row carrying the type wins over one that omits it.
    if (!entry.assetType && tx.asset_type) entry.assetType = String(tx.asset_type).toUpperCase()
    entry.txs.push(tx)
    byTicker.set(key, entry)
  }

  const positions: ReplayedPosition[] = []
  const onPositions: ReplayedPosition[] = []

  byTicker.forEach((entry, ticker) => {
    // Running average cost is sequential: order is part of the arithmetic.
    //
    // Ordering by day alone leaves same-day rows in caller-array order, and one
    // adverse order is catastrophic: a VENTA reaching calculateRunningAvgCost
    // before its COMPRA hits the `if (quantity > 0)` guard (portfolio-engine.ts:56)
    // and is discarded as a silent no-op, so the replay emits an OPEN position
    // for a ticker that was closed — repeated in EVERY later day.
    //
    // Three levels: day, then insertion time, then COMPRA before VENTA. The last
    // one is not a guess at what really happened — when created_at ties there is
    // no information left, so it deliberately picks the bounded error (a slightly
    // different avg_cost) over the unbounded one (a fabricated position that
    // never closes).
    const ordered = [...entry.txs].sort((a, b) => {
      const byDay = dayOf(a.date).localeCompare(dayOf(b.date))
      if (byDay !== 0) return byDay

      const byCreated = String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
      if (byCreated !== 0) return byCreated

      return (a.operation === 'COMPRA' ? 0 : 1) - (b.operation === 'COMPRA' ? 0 : 1)
    })

    const { avgCost, quantity, costBasis } = calculateRunningAvgCost(
      ordered.map(t => ({
        operation: t.operation as Operation,
        quantity: t.quantity,
        price: t.price,
        commission: t.commission ?? 0,
      }))
    )

    if (!(quantity > 0.0001)) return // closed on or before this day (matches engine's dust threshold)

    const position: ReplayedPosition = {
      ticker,
      quantity,
      avg_cost: avgCost,
      total_invested: costBasis,
    }

    if (entry.assetType === 'ON') onPositions.push(position)
    else positions.push(position)
  })

  let cashBalance = 0
  for (const movement of movements) {
    if (dayOf(movement.date) > cutoff) continue
    cashBalance += cashDelta(movement.type, movement.amount)
  }

  return { positions, onPositions, cashBalance }
}
