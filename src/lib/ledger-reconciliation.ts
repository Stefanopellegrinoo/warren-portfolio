/**
 * Loads one user's ledger and stored state and asks the existing gate whether
 * replaying the former reproduces the latter. No new comparison logic lives
 * here: replayPortfolioAt + reconcileUser are the same pair the snapshot
 * backfill trusts.
 *
 * A failed read THROWS. Treating it as "no rows" would replay an empty ledger
 * against empty storage and report a false PASS.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeError } from './errors'
import { replayPortfolioAt, type ReplayMovement, type ReplayTransaction } from './portfolio-replay'
import { reconcileUser, type GateResult, type StoredPosition } from './backfill-gate'
import { argentinaDate } from './utils'

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

export async function reconcileLedger(
  supabase: SupabaseClient,
  userId: string,
  today: string = argentinaDate()
): Promise<GateResult> {
  const [transactions, movements, positions, onPositions, cash] = await Promise.all([
    selectAll<ReplayTransaction>(
      supabase, 'transactions',
      'ticker, operation, quantity, price, commission, date, asset_type, created_at', userId
    ),
    selectAll<ReplayMovement>(supabase, 'cash_movements', 'type, amount, date', userId),
    selectAll<StoredPosition>(supabase, 'positions', 'ticker, quantity, total_invested', userId),
    selectAll<StoredPosition>(supabase, 'on_positions', 'ticker, quantity, total_invested', userId),
    selectAll<{ balance: number }>(supabase, 'cash_balance', 'balance', userId),
  ])

  return reconcileUser(replayPortfolioAt(transactions, movements, today), {
    positions,
    onPositions,
    cashBalance: Number(cash[0]?.balance ?? 0),
  })
}
