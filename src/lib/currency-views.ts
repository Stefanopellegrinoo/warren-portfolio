/**
 * Loads what buildCurrencyViews needs for a user: their ledger, today's FX, the
 * CEDEAR ratios and the cached peso-line prices. Used by the worker's summary
 * cache and by /api/positions when it has to compute the summary itself.
 *
 * WORKER-SAFE: relative value imports only (runs under tsx).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { cached } from './cache'
import { getFxRate, type FxKind } from './fx-rates'
import { fetchQuotes } from './yahoo-finance'
import { localPriceKey } from './data912-client'
import { buildCurrencyViews, localSymbol, type CurrencyViews, type EnginePosition, type LedgerTrade } from './multicurrency'
import { fxLookupFrom } from './trade-record-backfill'
import { argentinaDate } from './utils'

const LEDGER_COLUMNS =
  'ticker, date, created_at, operation, asset_type, quantity, price, commission, ' +
  'trade_currency, trade_quantity, trade_price, trade_commission, fx_mep, fx_ccl'
const PAGE = 1000
const FX_TODAY_TTL = 300
// A trade-date FX falls back to the previous day with a rate; a week covers any holiday run.
const FX_FALLBACK_DAYS = 10

export interface CurrencyContext {
  fx: { mep: { rate: number; date: string }; ccl: { rate: number; date: string } }
  ratios: Map<string, number>
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

/**
 * Today's MEP and CCL (the latest fx_rates row) and the CEDEAR ratios, shared by
 * every user. null when a rate is missing: then no view is built, and the
 * Resumen keeps showing the USD figures.
 */
export async function loadCurrencyContext(supabase: SupabaseClient): Promise<CurrencyContext | null> {
  const today = argentinaDate()
  const rate = (kind: FxKind) => cached(`fx:latest:${today}:${kind}`, FX_TODAY_TTL, () => getFxRate(supabase, today, kind))
  const [mep, ccl, cedears] = await Promise.all([
    rate('mep'),
    rate('ccl'),
    selectAll<{ ticker: string; ratio: number }>((a, b) => supabase.from('cedears').select('ticker, ratio').range(a, b)),
  ])
  if (!mep || !ccl) return null
  const ratios = new Map<string, number>()
  for (const c of cedears) if (Number(c.ratio) > 0) ratios.set(c.ticker, Number(c.ratio))
  return { fx: { mep, ccl }, ratios }
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

export async function currencyViewsFor(
  supabase: SupabaseClient,
  userId: string,
  ctx: CurrencyContext,
  valued: { positions: EnginePosition[]; onPositions: EnginePosition[]; cashBalance: number }
): Promise<CurrencyViews> {
  const trades = await selectAll<LedgerTrade>((a, b) =>
    supabase.from('transactions').select(LEDGER_COLUMNS).eq('user_id', userId)
      .order('date', { ascending: true }).order('created_at', { ascending: true }).range(a, b))

  // Rows loaded after 044 without a ticket carry no FX: look up their trade date.
  const missing = trades.filter(t => t.fx_mep == null || t.fx_ccl == null).map(t => t.date).sort()
  let fxRows: { date: string; kind: FxKind; buy: number; sell: number }[] = []
  if (missing.length > 0) {
    const from = new Date(Date.parse(missing[0]) - FX_FALLBACK_DAYS * 86_400_000).toISOString().slice(0, 10)
    fxRows = await selectAll((a, b) =>
      supabase.from('fx_rates').select('date, kind, buy, sell').gte('date', from).lte('date', missing[missing.length - 1])
        .order('date', { ascending: true }).range(a, b))
  }

  const symbols = Array.from(new Set(valued.positions.map(p => localSymbol(p.ticker))))
  const lkp = await fetchQuotes(symbols.map(localPriceKey))
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
  })
}
