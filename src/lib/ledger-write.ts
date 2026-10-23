/**
 * The write path's checks and answers from the ledger core (odd/tasks/nucleo-ledger.md T5.1, S5).
 *
 * The write RPCs (migration 046) only validate inputs and insert ledger rows; nothing maintains
 * a stored position any more. So "cannot sell more than held" is the core's own rule, run here
 * on the ledger as it would be after the write, before anything is inserted. A write that adds
 * no NEW oversell is accepted: an account whose ledger is already inconsistent can still be
 * corrected, it just cannot be made worse.
 *
 * This check and the insert are not one transaction, so process_transaction_atomic (046)
 * serializes sales of one ticker per user with an advisory lock and re-checks the total held
 * from the ledger: two concurrent sales cannot both pass.
 * ponytail: the RPC's re-check is on the total, not per date; a concurrent edit that makes an
 * earlier-dated sale oversell is caught only by this dated check. Move the dated check into
 * SQL if that ever matters.
 *
 * WORKER-SAFE: relative value imports only (the import worker validates through here).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClosedTrade, Position } from '@/types'
import { normalizeError } from './errors'
import { ledgerAt, type LedgerIssue, type LedgerTrade } from './ledger-core'
import { loadPortfolioNow, NO_DATE_CUTOFF, type PortfolioNow } from './ledger-now'
import { argentinaDate } from './utils'

export type LedgerRow = LedgerTrade & { id?: string }

const PAGE = 1000
const COLUMNS = 'id, ticker, operation, quantity, price, commission, date, asset_type, created_at'
const num = (n: number) => String(Number(n.toFixed(6)))

export class OversellError extends Error {
  /** Read by every route's `status === 400` branch. */
  readonly status = 400
  constructor(readonly issue: LedgerIssue) {
    super(`No podés vender ${num(issue.requested)} ${issue.ticker} el ${issue.date}: a esa fecha tenías ${num(issue.held)}.`)
    this.name = 'OversellError'
  }
}

/** Every trade row of the user, paginated (ordered on every page). Throws on a failed read. */
export async function loadTradeRows(sb: SupabaseClient, userId: string): Promise<LedgerRow[]> {
  const rows: LedgerRow[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await sb.from('transactions').select(COLUMNS).eq('user_id', userId)
      .order('id', { ascending: true }).range(offset, offset + PAGE - 1)
    if (error) throw normalizeError(error)
    rows.push(...((data ?? []) as LedgerRow[]))
    if ((data ?? []).length < PAGE) return rows
  }
}

/** Pure: the first oversell `after` has that `before` did not (same ticker, day and quantity). */
export function newOversell(before: LedgerTrade[], after: LedgerTrade[]): LedgerIssue | null {
  const key = (i: LedgerIssue) => `${i.ticker}|${i.date}|${i.requested}`
  const known = new Set(ledgerAt(before, [], NO_DATE_CUTOFF).issues.map(key))
  return ledgerAt(after, [], NO_DATE_CUTOFF).issues.find(i => !known.has(key(i))) ?? null
}

/**
 * Throws OversellError when `change` (the ledger after the write) sells more than held anywhere.
 * `baseline` = the rows whose existing oversells are tolerated (default: the current ledger).
 */
export async function assertNoNewOversell(
  sb: SupabaseClient,
  userId: string,
  change: (rows: LedgerRow[]) => LedgerRow[],
  baseline?: (rows: LedgerRow[]) => LedgerRow[],
): Promise<void> {
  const rows = await loadTradeRows(sb, userId)
  const issue = newOversell(baseline ? baseline(rows) : rows, change(rows))
  if (issue) throw new OversellError(issue)
}

/** A trade about to be inserted, as the core will read it (sorted after the day's existing rows). */
export function pendingTrade(t: { ticker: string; operation: string; quantity: number; price: number; commission?: number | null; date: string; assetType?: string | null }): LedgerRow {
  return {
    ticker: t.ticker.trim().toUpperCase(), operation: t.operation, quantity: t.operation === 'VENTA' ? -Math.abs(t.quantity) : Math.abs(t.quantity),
    price: t.price, commission: t.commission ?? 0, date: t.date, asset_type: t.assetType ?? 'ACCION', created_at: new Date().toISOString(),
  }
}

/** The ticker's position and latest realized sale after a write, from the core (the old RPC's answer). */
export async function stateAfterWrite(
  sb: SupabaseClient, userId: string, ticker: string, kind: 'ON' | 'STOCK', withSale: boolean,
): Promise<{ position: Position | null; closedTrade: ClosedTrade | null; now: PortfolioNow }> {
  const now = await loadPortfolioNow(sb, userId, argentinaDate())
  const clean = ticker.trim().toUpperCase()
  const position = (kind === 'ON' ? now.onPositions : now.stockPositions).find(p => p.ticker === clean) ?? null
  const sales = (kind === 'ON' ? now.onClosedTrades : now.stockClosedTrades).filter(c => c.ticker === clean)
  const closedTrade = withSale ? sales.reduce<ClosedTrade | null>((last, c) => (!last || c.close_date >= last.close_date ? c : last), null) : null
  return { position, closedTrade, now }
}
