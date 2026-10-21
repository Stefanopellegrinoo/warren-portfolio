import type { SupabaseClient } from '@supabase/supabase-js'
import type { Holding } from './on-my-portfolio'

/** The signed-in user's open ON positions (READ ONLY, through their own RLS-scoped client). quantity = VN / 100. */
export async function loadOnHoldings(sb: SupabaseClient, userId: string): Promise<Holding[]> {
  const { data, error } = await sb.from('on_positions').select('ticker, quantity').eq('user_id', userId).gt('quantity', 0)
  if (error) throw new Error(`on_positions: ${error.message}`)
  return (data ?? []).map((r: { ticker: string; quantity: number | string }) => ({ ticker: r.ticker, quantity: Number(r.quantity) }))
}
