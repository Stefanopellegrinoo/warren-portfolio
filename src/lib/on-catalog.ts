// Server-side read path for the ON explorer/detail: catalog + raw flows + curated
// overrides + events + daily check + sovereign curve (all public-read tables) and
// the live data912 D-line price, analysed per request (R3.10). Read-only: nothing
// derived is written anywhere, and the only cache is the 5-min data912 fetch.
import type { SupabaseClient } from '@supabase/supabase-js'
import { settlementDate } from './ar-calendar'
import { analyzeOn, type CheckRow, type EventRow, type OnAnalysis, type SovPoint, type TermsRow } from './on-analytics'
import { isOnTermsStale } from './on-terms-health'
import type { OverrideRow } from './on-terms'
import { fetchAllData912Quotes } from './data912-client'
import { argentinaDate } from './utils'

const PAGE = 1000 // PostgREST default max rows per request
const PRICE_CACHE_MS = 5 * 60_000
const PRICE_FAILURE_CACHE_MS = 45_000 // after an outage, do not hammer data912 on every request
const PRICE_TIMEOUT_MS = 5_000
const CATALOG_CACHE_MS = 60_000 // the catalog changes once a day (nightly ingest)

export interface PriceFeed {
  prices: Map<string, number> // D ticker -> data912 `c` (a DIRTY price, see DATA912_C_IS_DIRTY)
  fetchedAt: string
}

export interface CatalogResult {
  analyses: OnAnalysis[]
  asOf: string | null // BYMA Educa as-of of the stored catalog
  stale: boolean
  prices: { ok: boolean; fetchedAt: string | null }
}

let priceCache: { at: number; feed: PriceFeed | null } | null = null
let catalogCache: { at: number; data: CatalogTables } | null = null

/** Test hook: forget both in-process caches. */
export function resetOnCaches(): void {
  priceCache = null
  catalogCache = null
}

/** D-suffixed rows of the data912 corporate feed: 5 min cache on success, ~45s on failure. Null on outage. */
export async function getOnPrices(): Promise<PriceFeed | null> {
  if (priceCache && Date.now() - priceCache.at < (priceCache.feed ? PRICE_CACHE_MS : PRICE_FAILURE_CACHE_MS)) return priceCache.feed
  let feed: PriceFeed | null = null
  try {
    const quotes = await fetchAllData912Quotes(AbortSignal.timeout(PRICE_TIMEOUT_MS))
    const prices = new Map<string, number>()
    for (const q of quotes) if (q.symbol?.endsWith('D') && typeof q.c === 'number' && q.c > 0) prices.set(q.symbol, q.c)
    if (prices.size > 0) feed = { prices, fetchedAt: new Date().toISOString() }
  } catch {
    feed = null
  }
  priceCache = { at: Date.now(), feed }
  return feed
}

type Row = Record<string, any>
type Page = PromiseLike<{ data: Row[] | null; error: { message: string } | null }>

async function fetchAll(table: string, query: (from: number, to: number) => Page): Promise<Row[]> {
  const out: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) return out
  }
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

const toTerms = (r: Row): TermsRow => ({
  isin: r.isin,
  tickerO: r.ticker_o,
  tickerD: r.ticker_d ?? null,
  tickerC: r.ticker_c ?? null,
  issuer: r.issuer ?? null,
  description: r.description ?? null,
  law: r.law,
  currency: r.currency,
  paymentPlaza: r.payment_plaza ?? null,
  est: r.est ?? null,
  frequency: r.frequency ?? null,
  issueDate: r.issue_date,
  maturityDate: r.maturity_date,
  couponRate: num(r.coupon_rate),
  residualPct: num(r.residual_pct) ?? 100, // NOT NULL in migration 039; the default only guards a malformed row
  accrualStart: r.accrual_start,
  issuedAmountByma: num(r.issued_amount_byma),
  adtvO: num(r.adtv_o),
  adtvD: num(r.adtv_d),
  adtvC: num(r.adtv_c),
  asOf: r.as_of,
})

const toCheck = (r: Row): CheckRow => ({
  asOf: r.as_of,
  bymaYtmPct: num(r.byma_ytm),
  methodYtmPct: num(r.method_ytm),
  methodDiffBp: num(r.method_diff_bp),
  termsYtmPct: num(r.terms_ytm),
  termsDiffBp: num(r.terms_diff_bp),
  flagged: r.flagged === true,
})

function groupBy<T>(rows: Row[], map: (r: Row) => T): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const r of rows) out.set(r.isin, [...(out.get(r.isin) ?? []), map(r)])
  return out
}

export interface LoadOptions {
  now?: Date
  isin?: string
  getPrices?: () => Promise<PriceFeed | null>
}

interface CatalogTables {
  terms: Row[]
  flows: Row[]
  overrides: Row[]
  events: Row[]
  checks: Row[]
  curve: Row[]
}

const readTable = (sb: SupabaseClient, table: string, orders: string[], filter?: (q: any) => any) =>
  fetchAll(table, (a, b) => {
    let q: any = sb.from(table).select('*')
    if (filter) q = filter(q)
    for (const o of orders) q = q.order(o)
    return q.range(a, b)
  })

/** The whole public catalog, cached ~60s in-process (shared by list and detail; failures are never cached). */
async function readCatalog(sb: SupabaseClient): Promise<CatalogTables> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_CACHE_MS) return catalogCache.data
  const terms = await readTable(sb, 'on_terms', ['isin'])
  const asOf = terms.map((t) => t.as_of as string).sort().pop() ?? null
  const [flows, overrides, events, checks, curve] = await Promise.all([
    readTable(sb, 'on_cashflows', ['isin', 'flow_date']),
    readTable(sb, 'on_terms_overrides', ['isin', 'field']),
    readTable(sb, 'on_corporate_events', ['id']),
    asOf ? readTable(sb, 'on_yield_checks', ['isin'], (q) => q.eq('as_of', asOf)) : Promise.resolve([]),
    readTable(sb, 'on_sov_curve', ['ticker']),
  ])
  const data = { terms, flows, overrides, events, checks, curve }
  catalogCache = { at: Date.now(), data }
  return data
}

export async function loadOnAnalyses(sb: SupabaseClient, opts: LoadOptions = {}): Promise<CatalogResult> {
  const now = opts.now ?? new Date()
  const today = argentinaDate(now)
  const [tables, feed] = await Promise.all([readCatalog(sb), (opts.getPrices ?? getOnPrices)()])
  // Scope by ISIN in memory; the sovereign curve is global and is never scoped.
  const terms = opts.isin ? tables.terms.filter((r) => r.isin === opts.isin) : tables.terms
  const asOf = tables.terms.map((t) => t.as_of as string).sort().pop() ?? null

  const flowsBy = groupBy(tables.flows, (r) => ({ date: r.flow_date as string, ren: num(r.ren) ?? 0, amo: num(r.amo) ?? 0 }))
  const overridesBy = groupBy(tables.overrides, (r): OverrideRow => ({ isin: r.isin, field: r.field, value: r.value, sourceUrl: r.source_url, verifiedAt: r.verified_at ?? null }))
  const eventsBy = groupBy(tables.events, (r): EventRow => ({ kind: r.kind, eventDate: r.event_date, note: r.note ?? null, sourceUrl: r.source_url, verifiedAt: r.verified_at ?? null }))
  const checkBy = new Map(tables.checks.map((r) => [r.isin as string, toCheck(r)]))
  const sov: SovPoint[] = tables.curve.flatMap((r) => (num(r.ytm) !== null && num(r.dm) !== null ? [{ law: r.law, ytmPct: Number(r.ytm), dm: Number(r.dm) }] : []))
  const settle = settlementDate(today)

  return {
    analyses: terms.map(toTerms).map((t) =>
      analyzeOn({
        terms: t,
        flows: flowsBy.get(t.isin) ?? [],
        overrides: overridesBy.get(t.isin) ?? [],
        events: eventsBy.get(t.isin) ?? [],
        check: checkBy.get(t.isin) ?? null,
        curve: sov,
        price: t.tickerD ? feed?.prices.get(t.tickerD) ?? null : null,
        settle,
      })
    ),
    asOf,
    stale: asOf === null || isOnTermsStale(asOf, today),
    prices: { ok: feed !== null, fetchedAt: feed?.fetchedAt ?? null },
  }
}

export interface PricePoint {
  date: string
  close: number // data912 `c` of the D line: dirty
}

const HISTORY_DAYS = 365

/** Closes of the D line, oldest first. History is secondary: any failure yields an empty chart, not an error. */
export async function loadPriceHistory(sb: SupabaseClient, tickerD: string | null): Promise<PricePoint[]> {
  if (!tickerD) return []
  try {
    const { data, error } = await sb
      .from('on_price_history')
      .select('price_date, close')
      .eq('ticker', tickerD)
      .order('price_date', { ascending: false })
      .limit(HISTORY_DAYS)
    if (error) return []
    return (data ?? [])
      .map((r: Row) => ({ date: r.price_date as string, close: Number(r.close) }))
      .filter((p: PricePoint) => Number.isFinite(p.close))
      .reverse()
  } catch {
    return []
  }
}
