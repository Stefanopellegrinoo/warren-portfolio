/**
 * Payment schedules of the ONs a user holds, in the shape the ledger core reads
 * (odd/tasks/nucleo-ledger.md T3.1): ledger ticker → merged flows per 100 original VN.
 * A ticker resolves to its ISIN through on_terms (D, then C, then O line). A bond no
 * longer in on_terms (matured, delisted) gets no schedule; scheduleGaps then asks the
 * user for its payments (S8).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadFlowRowsMany, mergeFlowHistory, type FlowRow } from './on-flow-history'

// ponytail: backward-derived flows (deriveBackwardFlows) are not merged here yet; bonistas
// covers ~24 months and older gaps are asked from the user. Add them when a user needs older history.

const SAFE_TICKER = /^[A-Z0-9]+$/

export async function loadSchedules(sb: SupabaseClient, tickers: string[], today: string): Promise<Map<string, FlowRow[]>> {
  const wanted = [...new Set(tickers.map(t => t.trim().toUpperCase()))].filter(t => SAFE_TICKER.test(t))
  const out = new Map<string, FlowRow[]>()
  if (wanted.length === 0) return out

  const list = wanted.join(',')
  const { data: terms, error } = await sb
    .from('on_terms')
    .select('isin, ticker_o, ticker_d, ticker_c')
    .or(`ticker_d.in.(${list}),ticker_c.in.(${list}),ticker_o.in.(${list})`)
  if (error) throw new Error(`on_terms: ${error.message}`)

  const isinOf = new Map<string, string>()
  for (const line of ['ticker_d', 'ticker_c', 'ticker_o'] as const) {
    for (const t of terms ?? []) if (t[line] && !isinOf.has(t[line])) isinOf.set(t[line], t.isin)
  }
  const isins = [...new Set(wanted.flatMap(t => isinOf.get(t) ?? []))]
  if (isins.length === 0) return out

  const rows = await loadFlowRowsMany(sb, isins)
  for (const ticker of wanted) {
    const isin = isinOf.get(ticker)
    if (!isin) continue
    const { history, current } = rows.get(isin) ?? { history: [], current: [] }
    out.set(ticker, mergeFlowHistory({ today, history, current, inCatalog: true, derived: [] })
      .map(({ date, ren, amo }) => ({ date, ren, amo })))
  }
  return out
}
