/**
 * Canonical read path for the transactions that feed per-universe boundary
 * flows — one query shape, one ordering, one error contract, shared by
 * /api/statistics and /api/statistics/ons.
 *
 * This exists for the same reason snapshot-series.ts does. PostgREST caps a
 * response at 1000 rows, and a truncated FLOW list is worse than a truncated
 * series: every buy or sell whose flow went missing stops being a transfer
 * and becomes a market move of its full notional. On the `measurable`
 * universe — the default of /api/statistics and the General tab's headline —
 * a dropped ON purchase reproduces exactly the fabricated ~10% loss the
 * ON-boundary fix removed. There is no error and no missing chart; the number
 * is simply wrong.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeError } from './errors'
import type { FlowTransaction } from './asset-universe'

const PAGE = 1000

const COLUMNS = 'date, operation, quantity, price, commission, asset_type'

export async function fetchFlowTransactions(
  supabase: SupabaseClient,
  userId: string
): Promise<FlowTransaction[]> {
  const rows: FlowTransaction[] = []

  for (let offset = 0; ; offset += PAGE) {
    // The order clause is re-applied on every page ON PURPOSE: it is what
    // makes the pages concatenate deterministically instead of interleaving
    // arbitrarily. Postgres guarantees nothing across two LIMIT/OFFSET reads
    // without it. `id` breaks ties so a day with several trades cannot have
    // one of them land on both pages or neither.
    const { data, error } = await supabase
      .from('transactions')
      .select(COLUMNS)
      .eq('user_id', userId)
      .order('date', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1)

    if (error) throw normalizeError(error)

    const page = (data ?? []) as unknown as FlowTransaction[]
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}
