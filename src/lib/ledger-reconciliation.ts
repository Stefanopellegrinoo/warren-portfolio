/**
 * Loads one user's ledger and stored state and asks the gate whether the ledger
 * core reproduces the latter: holdings, cost, cash and realized P&L. This is the
 * cutover gate for dropping the stored tables (odd/tasks/nucleo-ledger.md T2.2).
 *
 * A failed read THROWS. Treating it as "no rows" would replay an empty ledger
 * against empty storage and report a false PASS.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeError } from './errors'
import { ledgerAt, type LedgerMovement, type LedgerState, type LedgerTrade } from './ledger-core'
import { compareRealized, reconcileUser, type GateResult, type StoredPosition } from './backfill-gate'

const PAGE = 1000

async function selectAll<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  userId: string
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    // Re-ordered on every page on purpose: LIMIT/OFFSET without ORDER BY can
    // serve a row twice or never. `id` is unique per table.
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq('user_id', userId)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw normalizeError(error)
    const page = (data ?? []) as unknown as T[]
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

/**
 * Current-state check: stored positions/cash already include rows dated in the
 * future (T+1, settlement dates; nothing blocks future dates on input), so the
 * replay must not cut by date.
 */
const NO_DATE_CUTOFF = '9999-12-31'

/**
 * The five reads are independent and not one snapshot, so a write landing
 * between them can look like a mismatch. Re-run once before reporting: a false
 * alarm on the dashboard costs more trust than a one-read-late true one.
 */
export async function reconcileLedger(
  supabase: SupabaseClient,
  userId: string,
  asOf: string = NO_DATE_CUTOFF
): Promise<GateResult> {
  const first = await reconcileOnce(supabase, userId, asOf)
  return first.ok ? first : reconcileOnce(supabase, userId, asOf)
}

async function reconcileOnce(supabase: SupabaseClient, userId: string, today: string): Promise<GateResult> {
  type Closed = { ticker: string; invested: number; proceeds: number }
  const [transactions, movements, positions, onPositions, cash, closed, onClosed] = await Promise.all([
    selectAll<LedgerTrade>(
      supabase, 'transactions',
      'ticker, operation, quantity, price, commission, date, asset_type, created_at', userId
    ),
    selectAll<LedgerMovement>(supabase, 'cash_movements', 'type, amount, date', userId),
    selectAll<StoredPosition>(supabase, 'positions', 'ticker, quantity, total_invested', userId),
    selectAll<StoredPosition>(supabase, 'on_positions', 'ticker, quantity, total_invested', userId),
    selectAll<{ balance: number }>(supabase, 'cash_balance', 'balance', userId),
    selectAll<Closed>(supabase, 'closed_trades', 'ticker, invested, proceeds', userId),
    selectAll<Closed>(supabase, 'on_closed_trades', 'ticker, invested, proceeds', userId),
  ])

  const core = ledgerAt(transactions, movements, today)
  const result = reconcileUser(asReplayState(core), {
    positions,
    onPositions,
    cashBalance: Number(cash[0]?.balance ?? 0),
  })
  const reasons = [...result.reasons]
  compareRealized(core.realized, [...closed, ...onClosed], reasons)
  for (const i of core.issues) reasons.push(`oversell ${i.ticker} on ${i.date}: sold ${i.requested}, held ${i.held}`)
  return { ok: reasons.length === 0, reasons }
}

function asReplayState(core: LedgerState) {
  const as = (kind: 'ON' | 'STOCK') => core.holdings
    .filter(h => h.assetType === kind)
    .map(h => ({ ticker: h.ticker, quantity: h.quantity, avg_cost: h.avgCost, total_invested: h.costBasis }))
  return { positions: as('STOCK'), onPositions: as('ON'), cashBalance: core.cash }
}
