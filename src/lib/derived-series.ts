// src/lib/derived-series.ts
/**
 * The derived history, I/O side: same signature as fetchSnapshotSeries, rows in
 * the same shape (plus `source`), so cutting a route over is a one-line swap.
 *
 * The full series is cached once per user in `derived:v1:{uid}` (15 min) with the
 * same version compare-and-set the summary cache uses: the version is read BEFORE
 * the database, and the write is discarded if a mutation bumped it meanwhile.
 * A degraded result (stale/missing bars, unknown splits, no CCL, a failed side
 * read, a partial derivation) is returned but never cached.
 *
 * Ledger reads (transactions, cash_movements) THROW on failure — a history built
 * from half a ledger is wrong, not degraded.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeError } from './errors'
import { ensureRedisConnected, getRedis } from './redis'
import { SUMMARY_SETEX_LUA } from './summary-cache'
import { getBars } from './bars-cache'
import { listCatalogued } from './ticker-catalog'
import { normalizeTickerForYahoo, fetchQuotes } from './yahoo-finance'
import { getHistoricalCCL } from './currency'
import { argentinaDate } from './utils'
import { unadjustSplits, toUsd, type DailyBar } from './historical-prices'
import { deriveHistory, type DerivedRow, type DeriveFlags, type OnMark } from './derive-history'
import type { ReplayMovement, ReplayTransaction } from './portfolio-replay'
import type { SnapshotSeriesRange } from './snapshot-series'

/** Shorter than SUMMARY_VERSION_TTL (1200s): the version guard must outlive the payload. */
export const DERIVED_TTL = 900
const PAGE = 1000

export interface DerivedSeries {
  rows: DerivedRow[]
  degraded: boolean
  flags: DeriveFlags
}

export interface DerivedDeps {
  today?: string
  getBars?: typeof getBars
  getHistoricalCCL?: typeof getHistoricalCCL
  fetchQuotes?: typeof fetchQuotes
  derive?: typeof deriveHistory
}

/** Walks every page of a query. The order is re-applied per page on purpose. */
async function readAll<T>(build: () => any, orderBy: string[]): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += PAGE) {
    let q = build()
    for (const col of orderBy) q = q.order(col, { ascending: true })
    const { data, error } = await q.range(offset, offset + PAGE - 1)
    if (error) throw normalizeError(error)
    rows.push(...((data ?? []) as T[]))
    if ((data ?? []).length < PAGE) return rows
  }
}

const norm = (t: string) => String(t).trim().toUpperCase()

function inRange(rows: DerivedRow[], { fromDate, toDate }: SnapshotSeriesRange): DerivedRow[] {
  return rows.filter(r => (!fromDate || r.snapshot_date >= fromDate) && (!toDate || r.snapshot_date <= toDate))
}

async function readCache(userId: string, today: string) {
  try {
    if (!(await ensureRedisConnected())) return null
    const raw = await getRedis()?.get(`derived:v1:${userId}`)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed?.asOf === today ? (parsed as { rows: DerivedRow[]; flags: DeriveFlags }) : null
  } catch {
    return null
  }
}

/** The version to guard the cache write with; `undefined` means "do not cache". */
async function readVersion(userId: string): Promise<string | null | undefined> {
  try {
    if (!(await ensureRedisConnected())) return undefined
    return (await getRedis()?.get(`summary:version:${userId}`)) ?? null
  } catch {
    return undefined
  }
}

async function writeCache(userId: string, version: string | null, today: string, rows: DerivedRow[], flags: DeriveFlags) {
  try {
    await getRedis()?.eval(
      SUMMARY_SETEX_LUA, 2, `derived:v1:${userId}`, `summary:version:${userId}`,
      version ?? '', DERIVED_TTL, JSON.stringify({ asOf: today, rows, flags })
    )
  } catch (err) {
    console.warn('[Derived] cache write failed:', err instanceof Error ? err.message : err)
  }
}

export async function getDerivedSeries(
  supabase: SupabaseClient,
  userId: string,
  range: SnapshotSeriesRange = {},
  deps: DerivedDeps = {}
): Promise<DerivedSeries> {
  const today = deps.today ?? argentinaDate()

  const hit = await readCache(userId, today)
  if (hit) return { rows: inRange(hit.rows, range), degraded: false, flags: hit.flags }

  const startVersion = await readVersion(userId)

  const transactions = await readAll<ReplayTransaction>(
    () => supabase.from('transactions')
      .select('ticker, operation, quantity, price, commission, date, asset_type, created_at').eq('user_id', userId),
    ['id']
  )
  const movements = await readAll<ReplayMovement>(
    () => supabase.from('cash_movements').select('type, amount, date').eq('user_id', userId),
    ['id']
  )

  let degraded = false
  const firstTxDate = transactions.map(t => String(t.date).slice(0, 10)).sort()[0] ?? today

  const isOn = (t: ReplayTransaction) => String(t.asset_type ?? '').toUpperCase() === 'ON'
  const stockTickers = Array.from(new Set(transactions.filter(t => !isOn(t)).map(t => norm(t.ticker))))
  const onTickers = Array.from(new Set(transactions.filter(isOn).map(t => norm(t.ticker))))

  // Which Yahoo symbol to ask for: the confirmed one, else the exchange-normalized string.
  const catalog = new Map<string, string>()
  try {
    for (const row of await listCatalogued(supabase)) catalog.set(norm(row.ticker), String(row.yahoo_symbol).trim())
  } catch (err) {
    console.warn('[Derived] ticker catalog unreadable, normalizing tickers instead:', err instanceof Error ? err.message : err)
  }
  const symbolOf = new Map(stockTickers.map(t => [t, catalog.get(t) ?? normalizeTickerForYahoo(t)]))

  const charts = await (deps.getBars ?? getBars)(Array.from(new Set(symbolOf.values())), new Date(firstTxDate))

  const needsCcl = Array.from(symbolOf.values()).some(s => s.endsWith('.BA'))
  let ccl = new Map<string, number>()
  if (needsCcl) {
    try {
      ccl = await (deps.getHistoricalCCL ?? getHistoricalCCL)(new Date(firstTxDate))
    } catch {
      // empty map -> every ARS bar is dropped and flagged below
    }
  }

  const barsByTicker = new Map<string, DailyBar[]>()
  for (const [ticker, symbol] of symbolOf) {
    const chart = charts.get(symbol)
    if (!chart || chart.degraded || !chart.splitsKnown) degraded = true
    let bars = unadjustSplits(chart?.bars ?? [], chart?.splits ?? [])
    if (symbol.endsWith('.BA')) {
      const usd = toUsd(bars, ccl)
      bars = usd.bars
      if (usd.degraded) degraded = true
    }
    barsByTicker.set(ticker, bars)
  }

  // ON closes, held ONs only, from the first trade on: other days of the feed must not widen the calendar.
  const onPricesByTicker = new Map<string, DailyBar[]>()
  const onMarks = new Map<string, OnMark>()
  if (onTickers.length > 0) {
    try {
      const prices = await readAll<{ ticker: string; price_date: string; close: number | string }>(
        () => supabase.from('on_price_history').select('ticker, price_date, close')
          .in('ticker', onTickers).gte('price_date', firstTxDate),
        ['ticker', 'price_date']
      )
      for (const p of prices) {
        const list = onPricesByTicker.get(norm(p.ticker)) ?? []
        list.push({ date: String(p.price_date).slice(0, 10), close: Number(p.close) })
        onPricesByTicker.set(norm(p.ticker), list)
      }
      const marks = await readAll<{ snapshot_date: string; ons_value: number | string | null; ons_invested: number | string | null }>(
        () => supabase.from('portfolio_snapshots').select('snapshot_date, ons_value, ons_invested')
          .eq('user_id', userId).eq('source', 'live').gte('snapshot_date', firstTxDate),
        ['snapshot_date']
      )
      for (const m of marks) {
        if (m.ons_value == null || m.ons_invested == null) continue
        onMarks.set(String(m.snapshot_date).slice(0, 10), { ons_value: Number(m.ons_value), ons_invested: Number(m.ons_invested) })
      }
    } catch (err) {
      console.warn('[Derived] ON prices/marks unreadable, ONs at cost:', err instanceof Error ? err.message : err)
      onPricesByTicker.clear()
      onMarks.clear()
      degraded = true
    }
  }

  const todayQuotes = await (deps.fetchQuotes ?? fetchQuotes)([...stockTickers, ...onTickers])

  const { rows, flags } = (deps.derive ?? deriveHistory)({
    userId, transactions, movements, barsByTicker, onPricesByTicker, onMarks, today, todayQuotes,
  })
  if (flags.failure != null) degraded = true

  if (!degraded && startVersion !== undefined) await writeCache(userId, startVersion, today, rows, flags)

  return { rows: inRange(rows, range), degraded, flags }
}
