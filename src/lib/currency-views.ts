/**
 * Loads what buildCurrencyViews needs for a user: their ledger and ON payments, today's FX, the
 * CEDEAR ratios and the cached peso-line prices. Used by the worker's summary
 * cache and by /api/positions when it has to compute the summary itself.
 *
 * cedears and fx_rates are market tables, read with the service role (anon/authenticated
 * have no SELECT on them, odd/tasks/security-hardening.md S12); the ledger stays on the
 * caller's client (RLS).
 *
 * WORKER-SAFE: relative value imports only (runs under tsx).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FxKind } from './fx-rates'
import { getDollarInfo } from './currency'
import { fetchQuotes } from './yahoo-finance'
import { localPriceKey } from './data912-client'
import { buildCurrencyViews, localSymbol, type CurrencyViews, type EnginePosition, type LedgerTrade } from './multicurrency'
import { fxLookupFrom } from './trade-record-backfill'
import { loadOverrides, loadPortfolioAndLedger, onTickersOf, type PortfolioNow } from './ledger-now'
import type { FlowOverride } from './ledger-core'
import type { FlowRow } from './on-flow-history'
import { loadSchedules } from './on-schedules'
import { loadSplits, type SplitsByTicker } from './stock-splits'
import { argentinaDate } from './utils'
import { createServiceClient } from './supabase-server'
import { memoByLedgerVersion } from './ledger-memo'

// A superset of the ledger core's trade columns, so one read can serve both (loadPortfolioForViews,
// the worker's loadAllLedgers).
export const LEDGER_COLUMNS =
  'ticker, date, created_at, operation, asset_type, quantity, price, commission, ' +
  'trade_currency, trade_quantity, trade_price, trade_commission, fx_mep, fx_ccl'
const PAGE = 1000
// A trade-date FX falls back to the previous day with a rate; a week covers any holiday run.
const FX_FALLBACK_DAYS = 10

export interface CurrencyContext {
  fx: { mep: { rate: number; date: string }; ccl: { rate: number; date: string } }
  ratios: Map<string, number>
  /** A rate came from its last known value while the live one refreshes behind. */
  stale?: boolean
}

/** Every row of a query, page by page (PostgREST caps a response at 1000 rows). */
async function selectAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await page(offset, offset + PAGE - 1)
    if (error) throw new Error(error.message)
    const batch = (data ?? []) as T[]
    rows.push(...batch)
    if (batch.length < PAGE) return rows
  }
}

// The CEDEAR list has no writer in the app: the worker reads it again only with the ledgers (ledger-memo.ts).
const cedearRatios = memoByLedgerVersion(() =>
  selectAll<{ ticker: string; ratio: number }>((a, b) => createServiceClient().from('cedears').select('ticker, ratio').range(a, b)))

/**
 * Today's MEP and CCL (live, from the app's one dollar series) and the CEDEAR ratios, shared by
 * every user. null when a rate is missing: then no view is built, and the
 * Resumen keeps showing the USD figures.
 */
export async function loadCurrencyContext(_supabase: SupabaseClient): Promise<CurrencyContext | null> {
  const rate = async (kind: FxKind) => {
    const live = await getDollarInfo(kind)
    return live && { rate: live.rate, date: argentinaDate(new Date(live.asOf)), lkp: live.source === 'lkp' }
  }
  const [mep, ccl, cedears] = await Promise.all([
    rate('mep'),
    rate('ccl'),
    cedearRatios(),
  ])
  if (!mep || !ccl) return null
  const ratios = new Map<string, number>()
  for (const c of cedears) if (Number(c.ratio) > 0) ratios.set(c.ticker, Number(c.ratio))
  return { fx: { mep: { rate: mep.rate, date: mep.date }, ccl: { rate: ccl.rate, date: ccl.date } }, ratios, stale: mep.lkp || ccl.lkp }
}

const orNull = (x: unknown) => (x == null ? null : Number(x))

/** numeric columns may arrive as strings; the module does arithmetic on them. */
const toNumbers = (t: LedgerTrade): LedgerTrade => ({
  ...t,
  quantity: Number(t.quantity),
  price: Number(t.price),
  commission: orNull(t.commission),
  trade_quantity: orNull(t.trade_quantity),
  trade_price: orNull(t.trade_price),
  trade_commission: orNull(t.trade_commission),
  fx_mep: orNull(t.fx_mep),
  fx_ccl: orNull(t.fx_ccl),
})

/** The user's ledger as the views need it, when the caller has already read it. */
export interface ViewsLedger {
  trades: LedgerTrade[]
  overrides: FlowOverride[]
  schedules: Map<string, FlowRow[]>
  splits: SplitsByTicker
  /** The trade-date FX, when the caller already read it (tradeDateFx). */
  fxRows?: FxRow[]
}

/**
 * The portfolio now and the ledger its currency views need, from ONE read of each table
 * (/api/positions on a summary miss): the trades are read with the views' columns, which
 * include every column the ledger core reads.
 */
export async function loadPortfolioForViews(
  supabase: SupabaseClient, userId: string, today: string
): Promise<{ portfolio: PortfolioNow; ledger: ViewsLedger }> {
  // The guard getFullPortfolio applies (portfolio-engine.ts): never read a ledger without a user.
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    throw new Error('[Security] userId inválido o ausente. Operación cancelada para prevenir corrupción de datos.')
  }
  const { now, ledger, schedules } = await loadPortfolioAndLedger(supabase, userId, today, LEDGER_COLUMNS)
  return { portfolio: now, ledger: { trades: ledger.trades as unknown as LedgerTrade[], overrides: ledger.overrides, schedules, splits: ledger.splits } }
}

/** The views' own read order (date, then created_at, NULLs last), for trades read in another order. */
const byDateCreated = (a: LedgerTrade, b: LedgerTrade) =>
  a.date < b.date ? -1 : a.date > b.date ? 1
    : a.created_at == null ? (b.created_at == null ? 0 : 1) : b.created_at == null ? -1
      : a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0

type FxRow = { date: string; kind: FxKind; buy: number; sell: number }

/** Rows loaded after 044 without a ticket carry no FX: the fx_rates around their trade dates. */
export async function tradeDateFx(trades: LedgerTrade[]): Promise<FxRow[]> {
  const missing = trades.filter(t => t.fx_mep == null || t.fx_ccl == null).map(t => t.date).sort()
  if (missing.length === 0) return []
  const from = new Date(Date.parse(missing[0]) - FX_FALLBACK_DAYS * 86_400_000).toISOString().slice(0, 10)
  const market = createServiceClient()
  return selectAll((a, b) =>
    market.from('fx_rates').select('date, kind, buy, sell').gte('date', from).lte('date', missing[missing.length - 1])
      .order('date', { ascending: true }).range(a, b))
}

/** `loaded`: the ledger the caller already read (loadPortfolioForViews); otherwise it is read here. */
export async function currencyViewsFor(
  supabase: SupabaseClient,
  userId: string,
  ctx: CurrencyContext,
  valued: { positions: EnginePosition[]; onPositions: EnginePosition[]; cashBalance: number },
  loaded?: ViewsLedger
): Promise<CurrencyViews> {
  const trades = loaded
    ? [...loaded.trades].sort(byDateCreated)
    : await selectAll<LedgerTrade>((a, b) =>
        supabase.from('transactions').select(LEDGER_COLUMNS).eq('user_id', userId)
          .order('date', { ascending: true }).order('created_at', { ascending: true }).range(a, b))

  const symbols = Array.from(new Set(valued.positions.map(p => localSymbol(p.ticker))))
  // The automatic ON payments the core applies to cost and cash (odd/tasks/nucleo-ledger.md T3.1).
  const today = argentinaDate()
  // Independent reads, together: trade-date FX, peso-line prices, ON payment overrides and schedules, stock splits.
  const [fxRows, lkp, overrides, schedules, splits] = await Promise.all([
    loaded?.fxRows ?? tradeDateFx(trades),
    fetchQuotes(symbols.map(localPriceKey)),
    loaded?.overrides ?? loadOverrides(supabase, userId),
    loaded?.schedules ?? loadSchedules(supabase, onTickersOf(trades.map(t => ({ ...t, created_at: t.created_at ?? null }))), today),
    loaded?.splits ?? loadSplits(),
  ])
  const local = new Map(symbols.flatMap(s => {
    const q = lkp.get(localPriceKey(s))
    return q ? [[s, q] as const] : []
  }))

  return buildCurrencyViews({
    positions: valued.positions,
    onPositions: valued.onPositions,
    trades: trades.map(toNumbers),
    cashBalance: valued.cashBalance,
    ratios: ctx.ratios,
    local,
    fx: ctx.fx,
    fxAt: fxLookupFrom(fxRows),
    payments: { schedules, overrides, today, splits },
  })
}
