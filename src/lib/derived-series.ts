// src/lib/derived-series.ts
/**
 * The derived history, I/O side (odd/tasks/nucleo-ledger.md T4.1): the ledger
 * (transactions, cash_movements, on_payment_overrides) plus market data in, the
 * snapshot-shaped series the history and statistics routes read out.
 *
 * Market data is fetched on demand: a held ON whose on_price_history does not
 * reach back to its first trade gets one Rava + bonistas backfill (at most once a
 * day per ticker); a failure is logged and the valuation rule covers the gap.
 *
 * The full series is cached once per user in `derived:v1:{uid}` (15 min) with the
 * same version compare-and-set the summary cache uses: the version is read BEFORE
 * the database, and the write is discarded if a mutation bumped it meanwhile.
 * A degraded result (stale/missing bars, unknown splits, no CCL, a failed side
 * read, a partial derivation) is returned but never cached.
 *
 * Ledger reads (transactions, cash_movements, overrides) THROW on failure — a history built
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
import { addDays } from './ar-calendar'
import { unadjustSplits, toUsd, type DailyBar } from './historical-prices'
import { deriveHistory, type DerivedRow, type DeriveFlags } from './derive-history'
import { loadSchedules } from './on-schedules'
import { backfillOnPriceHistory } from './rava-history'
import { backfillPastFlows } from './bonistas-flows'
import type { FlowRow } from './on-flow-history'
import type { Income, LedgerMovement, LedgerTrade } from './ledger-core'
import { loadOverrides } from './ledger-now'

export interface SeriesRange {
  /** Inclusive YYYY-MM-DD lower bound. */
  fromDate?: string
  /** Inclusive YYYY-MM-DD upper bound. */
  toDate?: string
}

/** Shorter than SUMMARY_VERSION_TTL (1200s): the version guard must outlive the payload. */
export const DERIVED_TTL = 900
const PAGE = 1000
/** An earliest close this close to the first trade covers it (weekends, holidays, no-trade days). */
const COVERED_WITHIN_DAYS = 7
/** One on-demand backfill per ticker per day, whoever asks. */
const BACKFILL_MARKER_TTL = 86_400

export interface DerivedSeries {
  rows: DerivedRow[]
  degraded: boolean
  flags: DeriveFlags
  /** The core's ON payments up to today (ledgerFlows turns them into risk-metric flows). */
  income: Income[]
}

export interface DerivedDeps {
  today?: string
  getBars?: typeof getBars
  getHistoricalCCL?: typeof getHistoricalCCL
  fetchQuotes?: typeof fetchQuotes
  derive?: typeof deriveHistory
  loadSchedules?: typeof loadSchedules
  backfillOnPriceHistory?: typeof backfillOnPriceHistory
  backfillPastFlows?: typeof backfillPastFlows
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

function inRange(rows: DerivedRow[], { fromDate, toDate }: SeriesRange): DerivedRow[] {
  return rows.filter(r => (!fromDate || r.snapshot_date >= fromDate) && (!toDate || r.snapshot_date <= toDate))
}

async function readCache(userId: string, today: string) {
  try {
    if (!(await ensureRedisConnected())) return null
    const raw = await getRedis()?.get(`derived:v1:${userId}`)
    const parsed = raw ? JSON.parse(raw) : null
    // Array.isArray(income): an entry written before T4.1 has another row meaning — recompute it.
    return parsed?.asOf === today && Array.isArray(parsed.income)
      ? (parsed as { rows: DerivedRow[]; flags: DeriveFlags; income: Income[] })
      : null
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

async function writeCache(userId: string, version: string | null, today: string, rows: DerivedRow[], flags: DeriveFlags, income: Income[]) {
  try {
    await getRedis()?.eval(
      SUMMARY_SETEX_LUA, 2, `derived:v1:${userId}`, `summary:version:${userId}`,
      version ?? '', DERIVED_TTL, JSON.stringify({ asOf: today, rows, flags, income })
    )
  } catch (err) {
    console.warn('[Derived] cache write failed:', err instanceof Error ? err.message : err)
  }
}

type PriceRow = { ticker: string; price_date: string; close: number | string }

const readOnPrices = (supabase: SupabaseClient, tickers: string[], from: string) =>
  readAll<PriceRow>(
    () => supabase.from('on_price_history').select('ticker, price_date, close').in('ticker', tickers).gte('price_date', from),
    ['ticker', 'price_date']
  )

/** The first caller of the day per ticker runs the backfill; without Redis every caller does. */
async function claimBackfill(ticker: string): Promise<boolean> {
  try {
    if (!(await ensureRedisConnected())) return true
    const redis = getRedis()
    return !redis || (await redis.set(`onbackfill:v1:${ticker}`, '1', 'EX', BACKFILL_MARKER_TTL, 'NX')) === 'OK'
  } catch {
    return true
  }
}

/**
 * Rava closes and bonistas past flows for ONs whose prices do not reach back to their first
 * trade. Never throws: a failed source is logged and the valuation rule (purchase price,
 * then last close) covers the gap. Returns whether any price backfill ran.
 */
async function backfillMissing(
  supabase: SupabaseClient, tickers: string[], firstTrade: Map<string, string>, today: string, deps: DerivedDeps
): Promise<boolean> {
  const claimed: string[] = []
  for (const t of tickers) if (await claimBackfill(t)) claimed.push(t)
  if (claimed.length === 0) return false

  const terms = new Map<string, { isin: string; ticker_o: string | null }>()
  try {
    const { data, error } = await supabase.from('on_terms').select('isin, ticker_o, ticker_d').in('ticker_d', claimed)
    if (error) throw normalizeError(error)
    for (const r of data ?? []) terms.set(norm(r.ticker_d), r)
  } catch (err) {
    console.warn('[Derived] on_terms unreadable, past flows not backfilled:', err instanceof Error ? err.message : err)
  }

  for (const t of claimed) {
    try {
      await (deps.backfillOnPriceHistory ?? backfillOnPriceHistory)(supabase, t, firstTrade.get(t)!, today)
    } catch (err) {
      console.warn(`[Derived] Rava backfill failed for ${t}:`, err instanceof Error ? err.message : err)
    }
    const term = terms.get(t)
    if (!term?.ticker_o) continue
    try {
      await (deps.backfillPastFlows ?? backfillPastFlows)(supabase, term.isin, term.ticker_o, today)
    } catch (err) {
      console.warn(`[Derived] bonistas backfill failed for ${t}:`, err instanceof Error ? err.message : err)
    }
  }
  return true
}

export async function getDerivedSeries(
  supabase: SupabaseClient,
  userId: string,
  range: SeriesRange = {},
  deps: DerivedDeps = {}
): Promise<DerivedSeries> {
  const today = deps.today ?? argentinaDate()

  const hit = await readCache(userId, today)
  if (hit) return { rows: inRange(hit.rows, range), degraded: false, flags: hit.flags, income: hit.income }

  const startVersion = await readVersion(userId)

  const transactions = await readAll<LedgerTrade>(
    () => supabase.from('transactions')
      .select('ticker, operation, quantity, price, commission, date, asset_type, created_at').eq('user_id', userId),
    ['id']
  )
  const movements = await readAll<LedgerMovement>(
    () => supabase.from('cash_movements').select('type, amount, date').eq('user_id', userId),
    ['id']
  )
  const overrides = await loadOverrides(supabase, userId)

  let degraded = false
  // The history starts at the first ledger date: a trade, or a deposit before it.
  const firstDate = [...transactions, ...movements].map(r => String(r.date).slice(0, 10)).sort()[0] ?? today

  const isOn = (t: LedgerTrade) => String(t.asset_type ?? '').toUpperCase() === 'ON'
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

  const charts = await (deps.getBars ?? getBars)(Array.from(new Set(symbolOf.values())), new Date(firstDate))

  const needsCcl = Array.from(symbolOf.values()).some(s => s.endsWith('.BA'))
  let ccl = new Map<string, number>()
  if (needsCcl) {
    try {
      ccl = await (deps.getHistoricalCCL ?? getHistoricalCCL)(new Date(firstDate))
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

    // ON closes from the first trade on (other days of the feed must not widen the calendar), fetched
  // on demand when a held ON lacks them; and the schedules that pay its coupons and amortizations.
  const onPricesByTicker = new Map<string, DailyBar[]>()
  let schedules = new Map<string, FlowRow[]>()
  if (onTickers.length > 0) {
    const firstTrade = new Map<string, string>()
    for (const t of transactions.filter(isOn)) {
      const d = String(t.date).slice(0, 10)
      if (!firstTrade.has(norm(t.ticker)) || d < firstTrade.get(norm(t.ticker))!) firstTrade.set(norm(t.ticker), d)
    }
    try {
      let prices = await readOnPrices(supabase, onTickers, firstDate)
      const missing = onTickers.filter(t => {
        const earliest = prices.filter(p => norm(p.ticker) === t).map(p => String(p.price_date).slice(0, 10)).sort()[0]
        return !earliest || earliest > addDays(firstTrade.get(t)!, COVERED_WITHIN_DAYS)
      })
      if (missing.length > 0 && (await backfillMissing(supabase, missing, firstTrade, today, deps))) {
        prices = await readOnPrices(supabase, onTickers, firstDate)
      }
      for (const p of prices) {
        const list = onPricesByTicker.get(norm(p.ticker)) ?? []
        list.push({ date: String(p.price_date).slice(0, 10), close: Number(p.close) })
        onPricesByTicker.set(norm(p.ticker), list)
      }
    } catch (err) {
      console.warn('[Derived] ON prices unreadable, ONs at cost:', err instanceof Error ? err.message : err)
      onPricesByTicker.clear()
      degraded = true
    }
    try {
      schedules = await (deps.loadSchedules ?? loadSchedules)(supabase, onTickers, today)
    } catch (err) {
      console.warn('[Derived] ON schedules unreadable, no automatic payments:', err instanceof Error ? err.message : err)
      degraded = true
    }
  }

  const todayQuotes = await (deps.fetchQuotes ?? fetchQuotes)([...stockTickers, ...onTickers])

  const { rows, flags, income } = (deps.derive ?? deriveHistory)({
    userId, transactions, movements, schedules, overrides, barsByTicker, onPricesByTicker, today, todayQuotes,
  })
  if (flags.failure != null) degraded = true
  // A stock without a live quote leaves today's row at its last close: never cache it. ONs have
  // no intraday quote by design (on_price_history covers them), so they do not degrade.
  if (flags.todayUnpriced.some(t => !onTickers.includes(norm(t)))) degraded = true

  if (!degraded && startVersion !== undefined) await writeCache(userId, startVersion, today, rows, flags, income)

  return { rows: inRange(rows, range), degraded, flags, income }
}
