/**
 * Stock splits by ledger ticker (odd/tasks/split-aware-ledger.md T2): the market table
 * stock_splits, filled by the worker (splits-ingest.ts) and read by every ledger computation.
 *
 * stock_splits is a market table with no anon/authenticated SELECT (migration 053), so the
 * read uses the service role. The whole table is cached in Redis; the worker drops the key
 * when it stores a new split.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SplitEvent } from './historical-prices'
import { cacheRoute, getCachedRoute } from './redis'
import { createServiceClient } from './supabase-server'

export const SPLITS_KEY = 'splits:v1'
const SPLITS_TTL = 86400
// ponytail: one page; a table past PostgREST's row cap throws instead of losing splits. Page it then.
const MAX_ROWS = 1000

export type SplitsByTicker = Map<string, SplitEvent[]>

interface SplitRow { ticker: string; date: string; numerator: number | string; denominator: number | string }

/** Every stored split, by ledger ticker (upper case), oldest first. Throws on an unreadable table. */
export async function loadSplits(supabase: SupabaseClient = createServiceClient()): Promise<SplitsByTicker> {
  let rows = await getCachedRoute<SplitRow[]>(SPLITS_KEY)
  if (!rows) {
    const { data, error } = await supabase
      .from('stock_splits')
      .select('ticker, date, numerator, denominator')
      .order('date')
      .range(0, MAX_ROWS - 1)
    if (error) throw new Error(`stock_splits read: ${error.message}`)
    if ((data ?? []).length >= MAX_ROWS) throw new Error(`stock_splits read: more than ${MAX_ROWS - 1} rows, page the read`)
    rows = (data ?? []) as SplitRow[]
    await cacheRoute(SPLITS_KEY, rows, SPLITS_TTL)
  }
  const out: SplitsByTicker = new Map()
  for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
    const ticker = r.ticker.trim().toUpperCase()
    out.set(ticker, [...(out.get(ticker) ?? []), { date: r.date, numerator: Number(r.numerator), denominator: Number(r.denominator) }])
  }
  return out
}
