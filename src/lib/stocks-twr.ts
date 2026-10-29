import type { SupabaseClient } from '@supabase/supabase-js'
import { getDerivedSeries } from './derived-series'
import { ledgerFlows } from './derive-history'
import { fetchFlowTransactions } from './flow-transactions'
import { fetchIncomeMovements } from './cash-flows'
import { computeUniverseTwr } from './asset-universe'
import type { TwrPoint } from './twr-series'

/**
 * The stock portfolio's flow-adjusted TWR, with the same inputs /api/statistics gives the
 * `stocks` universe: deposits, withdrawals, the trades and payments that cross its boundary.
 */
export async function loadStocksTwr(supabase: SupabaseClient, userId: string): Promise<TwrPoint[]> {
  const [derived, transactions, income] = await Promise.all([
    getDerivedSeries(supabase, userId),
    fetchFlowTransactions(supabase, userId),
    fetchIncomeMovements(supabase, userId),
  ])
  const automatic = ledgerFlows(derived.income)
  return computeUniverseTwr(derived.rows, 'stocks', {
    externalFlows: derived.externalFlows,
    transactions: [...transactions, ...automatic.transactions],
    income: [...income, ...automatic.income],
  }).series
}
