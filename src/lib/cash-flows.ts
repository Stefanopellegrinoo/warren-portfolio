/**
 * Canonical read path for the income inputs to per-universe flows.
 *
 * Income filters on type ONLY: it is income whether booked manually or written
 * by the RPC beside a transaction. External money in and out is the opposite
 * rule, `transaction_id IS NULL` (the bulk-import RPCs record a COMPRA as type
 * RETIRO and a VENTA as type DEPOSITO, so the type alone would sweep internal
 * reallocations in): it lives in derive-history.ts `externalFlowsOf`, computed
 * from the same movements as the derived rows (odd/tasks/statistics-truth.md S10).
 *
 * It paginates for the same reason snapshot-series.ts does: PostgREST caps a
 * response at 1000 rows, and a truncated flow list turns every dropped movement
 * into fabricated performance — no error, no missing chart, just a wrong number.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeError } from './errors'
import type { IncomeMovement } from './asset-universe'

const PAGE = 1000

/** Income paid by an asset class into cash. Unsigned — the universe decides
 *  the direction (see universeFlows). */
export async function fetchIncomeMovements(
  supabase: SupabaseClient,
  userId: string
): Promise<IncomeMovement[]> {
  const rows: IncomeMovement[] = []

  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('cash_movements')
      .select('date, type, amount')
      .eq('user_id', userId)
      .in('type', ['CUPON', 'DIVIDENDO'])
      .order('date', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1)

    if (error) throw normalizeError(error)

    const page = (data ?? []) as Array<{ date: string; type: 'CUPON' | 'DIVIDENDO'; amount: number }>
    for (const m of page) {
      rows.push({ date: m.date, type: m.type, amount: Math.abs(Number(m.amount)) })
    }
    if (page.length < PAGE) return rows
  }
}
