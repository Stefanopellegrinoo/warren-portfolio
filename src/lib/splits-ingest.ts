/**
 * Brings stock_splits up to Yahoo (odd/tasks/split-aware-ledger.md T2): the splits of every
 * stock or CEDEAR someone traded, from the first stock trade on. Writes only splits that are
 * new or whose ratio changed, then drops the cached table and the caches of the users who
 * traded those tickers, so their holdings, history and statistics are computed again.
 *
 * A symbol whose splits Yahoo did not report (historical() fallback, failure) keeps its stored
 * rows. ponytail: a split Yahoo later withdraws is never deleted here; delete the row by hand.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getBars } from './bars-cache'
import { invalidateUserCache, getRedis } from './redis'
import { SPLITS_KEY } from './stock-splits'
import { listCatalogued, yahooSymbols } from './ticker-catalog'

const PAGE = 1000
// Every run asks Yahoo again: the bars cache is otherwise fresh all day.
const FRESH_SEC = 3600

export interface IngestSplitsDeps {
  getBars?: typeof getBars
  listCatalogued?: typeof listCatalogued
  invalidateUserCache?: typeof invalidateUserCache
  dropCachedSplits?: () => Promise<void>
}

async function readAll(supabase: SupabaseClient, table: string, columns: string, orderBy: string[]): Promise<any[]> {
  const rows: any[] = []
  // A page may hold fewer rows than asked (PostgREST's row cap), so only an empty page ends.
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

const dropCachedSplits = async () => { await getRedis()?.del(SPLITS_KEY) }

export async function ingestSplits(
  supabase: SupabaseClient,
  deps: IngestSplitsDeps = {}
): Promise<{ tickers: number; written: number; unknown: string[] }> {
  const traders = new Map<string, Set<string>>()
  let first = ''
  for (const t of await readAll(supabase, 'transactions', 'ticker, date, user_id, asset_type', ['date', 'id'])) {
    if (String(t.asset_type ?? '').toUpperCase() === 'ON') continue
    const ticker = String(t.ticker).trim().toUpperCase()
    traders.set(ticker, (traders.get(ticker) ?? new Set()).add(t.user_id))
    const day = String(t.date).slice(0, 10)
    if (!first || day < first) first = day
  }
  if (traders.size === 0) return { tickers: 0, written: 0, unknown: [] }

  const symbolOf = yahooSymbols([...traders.keys()], await (deps.listCatalogued ?? listCatalogued)(supabase))
  const [charts, stored] = await Promise.all([
    (deps.getBars ?? getBars)([...new Set(symbolOf.values())], new Date(first), { maxAgeSec: FRESH_SEC }),
    readAll(supabase, 'stock_splits', 'ticker, date, numerator, denominator', ['ticker', 'date']),
  ])
  const ratioOf = new Map(stored.map(r => [`${r.ticker} ${r.date}`, `${Number(r.numerator)}/${Number(r.denominator)}`]))

  const unknown: string[] = []
  const rows = []
  const changed = new Set<string>()
  const fetchedAt = new Date().toISOString()
  for (const [ticker, symbol] of symbolOf) {
    const chart = charts.get(symbol)
    if (!chart?.splitsKnown) { unknown.push(ticker); continue }
    for (const s of chart.splits) {
      if (ratioOf.get(`${ticker} ${s.date}`) === `${s.numerator}/${s.denominator}`) continue
      rows.push({ ticker, date: s.date, numerator: s.numerator, denominator: s.denominator, yahoo_symbol: symbol, source: 'yahoo', fetched_at: fetchedAt })
      changed.add(ticker)
    }
  }

  if (rows.length > 0) {
    const { error } = await supabase.from('stock_splits').upsert(rows, { onConflict: 'ticker,date' })
    if (error) throw new Error(`stock_splits upsert: ${error.message}`)
    await (deps.dropCachedSplits ?? dropCachedSplits)()
    const users = new Set([...changed].flatMap(t => [...(traders.get(t) ?? [])]))
    await Promise.all([...users].map(u => (deps.invalidateUserCache ?? invalidateUserCache)(u)))
  }
  return { tickers: symbolOf.size, written: rows.length, unknown }
}
