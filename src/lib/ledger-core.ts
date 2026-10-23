/**
 * The ledger core (odd/tasks/nucleo-ledger.md T2.1): the one implementation of
 * holdings, running average cost, realized trades and cash at any date. "Today"
 * and every past day are the same function with a different date.
 *
 * Rules, in one place:
 * - Order: day, then insertion time, then COMPRA before VENTA (when insertion ties
 *   there is no information left; the buy-first choice bounds the error instead of
 *   fabricating a position that never closes).
 * - COMPRA adds qty × price + commission to the cost. VENTA keeps the average,
 *   removes qty × average from the cost, and realizes proceeds = qty × price − commission.
 * - Selling more than held sells what was held and is reported as an issue.
 * - A holding below DUST is closed; the next buy starts a new cost and first-bought date.
 * - Routes by asset_type ('ON' vs everything else), never by ticker suffix.
 *
 * WORKER-SAFE: pure, relative imports only.
 */
import { cashDelta } from './cash-signs'

const DUST = 0.0001

export interface LedgerTrade {
  ticker: string
  operation: string
  quantity: number
  price: number
  commission: number | null
  /** YYYY-MM-DD, possibly with a timestamp suffix. */
  date: string
  asset_type: string | null
  created_at: string | null
}

export interface LedgerMovement {
  type: string
  amount: number
  date: string
}

export type AssetKind = 'ON' | 'STOCK'

export interface Holding {
  ticker: string
  assetType: AssetKind
  quantity: number
  avgCost: number
  costBasis: number
  firstBought: string
}

export interface Realized {
  ticker: string
  assetType: AssetKind
  date: string
  quantity: number
  invested: number
  proceeds: number
  pnl: number
}

export type LedgerIssue = { kind: 'oversell'; ticker: string; date: string; requested: number; held: number }

export interface LedgerState {
  holdings: Holding[]
  realized: Realized[]
  cash: number
  issues: LedgerIssue[]
}

const dayOf = (date: string) => String(date).slice(0, 10)

function ordered(trades: LedgerTrade[]): LedgerTrade[] {
  return [...trades].sort((a, b) =>
    dayOf(a.date).localeCompare(dayOf(b.date))
    || String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
    || (a.operation === 'COMPRA' ? 0 : 1) - (b.operation === 'COMPRA' ? 0 : 1))
}

export function ledgerAt(trades: LedgerTrade[], movements: LedgerMovement[], date: string): LedgerState {
  const cutoff = dayOf(date)
  const open = new Map<string, Holding>()
  const kinds = new Map<string, AssetKind>()
  const realized: Realized[] = []
  const issues: LedgerIssue[] = []

  // A row carrying the type wins over one that omits it, wherever it sits.
  for (const t of trades) {
    const key = t.ticker.trim().toUpperCase()
    if (t.asset_type) kinds.set(key, t.asset_type.toUpperCase() === 'ON' ? 'ON' : kinds.get(key) ?? 'STOCK')
  }

  for (const t of ordered(trades)) {
    const day = dayOf(t.date)
    if (day > cutoff) continue
    const ticker = t.ticker.trim().toUpperCase()
    const assetType = kinds.get(ticker) ?? 'STOCK'
    const qty = Math.abs(t.quantity)
    const commission = t.commission ?? 0
    const h = open.get(ticker)

    if (t.operation === 'COMPRA') {
      const next = h ?? { ticker, assetType, quantity: 0, avgCost: 0, costBasis: 0, firstBought: day }
      next.costBasis += qty * t.price + commission
      next.quantity += qty
      next.avgCost = next.costBasis / next.quantity
      open.set(ticker, next)
    } else if (t.operation === 'VENTA') {
      const held = h?.quantity ?? 0
      if (qty > held + DUST) issues.push({ kind: 'oversell', ticker, date: day, requested: qty, held })
      const sold = Math.min(qty, held)
      if (!h || sold <= 0) continue
      const invested = sold * h.avgCost
      const proceeds = sold * t.price - commission
      realized.push({ ticker, assetType, date: day, quantity: sold, invested, proceeds, pnl: proceeds - invested })
      h.quantity -= sold
      h.costBasis -= invested
      if (h.quantity < DUST) open.delete(ticker)
    }
  }

  let cash = 0
  for (const m of movements) if (dayOf(m.date) <= cutoff) cash += cashDelta(m.type, m.amount)

  return { holdings: [...open.values()], realized, cash, issues }
}
