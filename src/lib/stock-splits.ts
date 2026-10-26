/**
 * Stock splits by ledger ticker (odd/tasks/split-aware-ledger.md T2): the market table
 * stock_splits, filled by the worker (splits-ingest.ts) and read by every ledger computation.
 *
 * stock_splits is a market table with no anon/authenticated SELECT (migration 053), so the
 * read uses the service role. The whole table is cached in Redis; the worker drops the key
 * when it stores a new split, and the cache lives an hour, so a drop lost to a Redis failure
 * leaves splits stale for an hour at most (the per-user caches live 15 minutes or less).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SplitEvent } from './historical-prices'
import { cacheRoute, getCachedRoute } from './redis'
import { createServiceClient } from './supabase-server'

export const SPLITS_KEY = 'splits:v1'
const SPLITS_TTL = 3600
const PAGE = 1000

export type SplitsByTicker = Map<string, SplitEvent[]>

interface SplitRow { ticker: string; date: string; numerator: number | string; denominator: number | string }

/** Every row of `table`, ordered on every page. A page may hold fewer rows than asked (PostgREST's row cap), so only an empty page ends. */
export async function readTable(supabase: SupabaseClient, table: string, columns: string, orderBy: string[]): Promise<any[]> {
  const rows: any[] = []
  for (let from = 0; ; ) {
    let q: any = supabase.from(table).select(columns)
    for (const col of orderBy) q = q.order(col)
    const { data, error } = await q.range(from, from + PAGE - 1)
    if (error) throw new Error(`${table} read: ${error.message}`)
    if (!data || data.length === 0) return rows
    rows.push(...data)
    from += data.length
  }
}

/** Every stored split, by ledger ticker (upper case), oldest first. Throws on an unreadable table. */
export async function loadSplits(supabase: SupabaseClient = createServiceClient()): Promise<SplitsByTicker> {
  let rows = await getCachedRoute<SplitRow[]>(SPLITS_KEY)
  if (!rows) {
    rows = (await readTable(supabase, 'stock_splits', 'ticker, date, numerator, denominator', ['ticker', 'date'])) as SplitRow[]
    await cacheRoute(SPLITS_KEY, rows, SPLITS_TTL)
  }
  const out: SplitsByTicker = new Map()
  for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
    const ticker = r.ticker.trim().toUpperCase()
    out.set(ticker, [...(out.get(ticker) ?? []), { date: r.date, numerator: Number(r.numerator), denominator: Number(r.denominator) }])
  }
  return out
}
