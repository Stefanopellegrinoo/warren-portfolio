import type { SupabaseClient } from '@supabase/supabase-js'
import type { Holding } from './on-my-portfolio'
import { loadPortfolioNow } from './ledger-now'
import { argentinaDate } from './utils'

/** The signed-in user's open ON positions from the ledger core (READ ONLY, RLS-scoped client). quantity = VN / 100. */
export async function loadOnHoldings(sb: SupabaseClient, userId: string, today: string = argentinaDate()): Promise<Holding[]> {
  const { onPositions } = await loadPortfolioNow(sb, userId, today)
  return onPositions.map(p => ({ ticker: p.ticker, quantity: p.quantity }))
}
