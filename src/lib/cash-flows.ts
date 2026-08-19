/**
 * Canonical read path for the cash-side inputs to per-universe flows.
 *
 * TWO queries on purpose, never one filtered in code. External money in and
 * out is `transaction_id IS NULL` — the bulk-import RPCs record a COMPRA as
 * type RETIRO and a VENTA as type DEPOSITO, so 152 of this portfolio's
 * movements are internal reallocations wearing external types, and the type
 * column alone would sweep them in. Income is the opposite: it is income
 * whether booked manually or written by the RPC beside a transaction, so it
 * filters on type ONLY. Each query carrying its own rule is what keeps that
 * distinction from being lost in a future edit.
 *
 * Both paginate for the same reason snapshot-series.ts does: PostgREST caps a
 * response at 1000 rows, and a truncated FLOW list turns every dropped
 * movement into fabricated performance — no error, no missing chart, just a
 * wrong number.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeError } from './errors'
import type { ExternalFlow } from './drawdown'
import type { IncomeMovement } from './asset-universe'

const PAGE = 1000

/** Genuine money in or out of the portfolio. Signed here: `amount` is stored
 *  unsigned and the direction lives in `type`. */
export async function fetchExternalFlows(
  supabase: SupabaseClient,
  userId: string
): Promise<ExternalFlow[]> {
  const rows: ExternalFlow[] = []

  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('cash_movements')
      .select('date, type, amount')
      .eq('user_id', userId)
      .is('transaction_id', null)
      .in('type', ['DEPOSITO', 'RETIRO'])
      .order('date', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1)

    if (error) throw normalizeError(error)

    const page = (data ?? []) as Array<{ date: string; type: string; amount: number }>
    for (const m of page) {
      const magnitude = Math.abs(Number(m.amount))
      rows.push({ date: m.date, amount: m.type === 'RETIRO' ? -magnitude : magnitude })
    }
    if (page.length < PAGE) return rows
  }
}

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
