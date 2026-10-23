/**
 * Current state from the ledger core (odd/tasks/nucleo-ledger.md T4.2b, S2, S5): every
 * screen that shows "now" (positions, ONs, cash, realized trades, statistics, the worker's
 * summaries) reads the ledger through here instead of the stored derived tables.
 *
 * "Now" includes future-dated rows (T+1, settlement dates; nothing blocks future dates on
 * input), exactly as the stored state did; automatic ON payments count only up to today.
 *
 * Ledger reads THROW on failure: a portfolio built from half a ledger is wrong, not empty.
 *
 * WORKER-SAFE: relative value imports only (user-portfolios runs inside the BullMQ worker).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClosedTrade, ONPosition, Position, Quote } from '@/types'
import { normalizeError } from './errors'
import { addDays, toMs } from './ar-calendar'
import { loadSchedules } from './on-schedules'
import type { FlowRow } from './on-flow-history'
import {
  ledgerAt, type AssetKind, type FlowOverride, type Holding, type LedgerMovement, type LedgerState,
  type LedgerTrade, type PaymentKind, type Realized,
} from './ledger-core'

export const NO_DATE_CUTOFF = '9999-12-31'
const PAGE = 1000
const TRADE_COLUMNS = 'ticker, operation, quantity, price, commission, date, asset_type, created_at'
const norm = (t: string) => String(t).trim().toUpperCase()
const day = (d: string) => String(d).slice(0, 10)

/** Walks every page. Ordered on every page: LIMIT/OFFSET without ORDER BY can serve a row twice or never. */
async function readAll<T>(build: () => any): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await build().order('id', { ascending: true }).range(offset, offset + PAGE - 1)
    if (error) throw normalizeError(error)
    rows.push(...((data ?? []) as T[]))
    if ((data ?? []).length < PAGE) return rows
  }
}

type OverrideRow = { user_id?: string; ticker: string; pay_date: string; kind: PaymentKind; amount: number | string | null }
const toOverride = (o: OverrideRow): FlowOverride => ({
  ticker: norm(o.ticker), date: day(o.pay_date), kind: o.kind, amount: o.amount == null ? null : Number(o.amount),
})

export interface UserLedger {
  trades: LedgerTrade[]
  movements: LedgerMovement[]
  overrides: FlowOverride[]
}

/** The user's corrections to automatic ON payments (amount, or null = not received). */
export async function loadOverrides(sb: SupabaseClient, userId: string): Promise<FlowOverride[]> {
  return (await readAll<OverrideRow>(() =>
    sb.from('on_payment_overrides').select('ticker, pay_date, kind, amount').eq('user_id', userId))).map(toOverride)
}

export async function loadLedger(sb: SupabaseClient, userId: string): Promise<UserLedger> {
  const [trades, movements, overrides] = await Promise.all([
    readAll<LedgerTrade>(() => sb.from('transactions').select(TRADE_COLUMNS).eq('user_id', userId)),
    readAll<LedgerMovement>(() => sb.from('cash_movements').select('type, amount, date').eq('user_id', userId)),
    loadOverrides(sb, userId),
  ])
  return { trades, movements, overrides }
}

/** Every user's ledger (service client, worker only), keyed by user id. */
export async function loadAllLedgers(sb: SupabaseClient): Promise<Map<string, UserLedger>> {
  const [trades, movements, overrides] = await Promise.all([
    readAll<LedgerTrade & { user_id: string }>(() => sb.from('transactions').select(`user_id, ${TRADE_COLUMNS}`)),
    readAll<LedgerMovement & { user_id: string }>(() => sb.from('cash_movements').select('user_id, type, amount, date')),
    readAll<OverrideRow & { user_id: string }>(() => sb.from('on_payment_overrides').select('user_id, ticker, pay_date, kind, amount')),
  ])
  const out = new Map<string, UserLedger>()
  const of = (userId: string) => {
    if (!out.has(userId)) out.set(userId, { trades: [], movements: [], overrides: [] })
    return out.get(userId)!
  }
  for (const t of trades) of(t.user_id).trades.push(t)
  for (const m of movements) of(m.user_id).movements.push(m)
  for (const o of overrides) of(o.user_id).overrides.push(toOverride(o))
  return out
}

export const onTickersOf = (trades: LedgerTrade[]) =>
  [...new Set(trades.filter(t => norm(t.asset_type ?? '') === 'ON').map(t => norm(t.ticker)))]

/** Pure: the ledger now, with automatic ON payments up to `today`. */
export function ledgerNowFrom(ledger: UserLedger, schedules: Map<string, FlowRow[]>, today: string): LedgerState {
  const paid = new Map([...schedules].map(([t, flows]) => [t, flows.filter(f => f.date <= today)]))
  const overrides = ledger.overrides.filter(o => o.date <= today)
  return ledgerAt(ledger.trades, ledger.movements, NO_DATE_CUTOFF, { schedules: paid, overrides })
}

/** S3, one rule everywhere: the live quote if positive, else the last close, else the holding's own cost. */
export function markPrice(live: number | null | undefined, lastClose: number | null | undefined, cost: number): number {
  if (Number(live) > 0) return Number(live)
  if (Number(lastClose) > 0) return Number(lastClose)
  return cost
}

export function toPositions(userId: string, holdings: Holding[], kind: AssetKind): Position[] {
  return holdings
    .filter(h => h.assetType === kind)
    .map(h => ({
      id: h.ticker, user_id: userId, ticker: h.ticker, quantity: h.quantity, avg_cost: h.avgCost,
      total_invested: h.costBasis, first_bought: h.firstBought, last_updated: h.firstBought, version: 0,
    }))
    .sort((a, b) => b.total_invested - a.total_invested)
}

/**
 * The core's realized sales in the closed-trade row shape the screens read.
 *
 * ponytail: the core's Realized carries no open date or sale price, so they are recovered
 * here: the open date is the firstBought of the position held at the end of the previous
 * day (none = opened the sale day), the price that of the same-day VENTA of that quantity
 * (else net proceeds / quantity). A close-and-rebuy inside one day before a second sale
 * dates that sale from the first open. Adding openDate and price to Realized (ledger-core)
 * removes this glue.
 */
export function closedTradesOf(userId: string, trades: LedgerTrade[], realized: Realized[]): ClosedTrade[] {
  return realized.map((r, i) => {
    const own = trades.filter(t => norm(t.ticker) === r.ticker)
    const open = ledgerAt(own, [], addDays(r.date, -1)).holdings[0]?.firstBought ?? r.date
    const sales = own.filter(t => t.operation === 'VENTA' && day(t.date) === r.date)
    const sale = sales.find(t => Math.abs(Math.abs(t.quantity) - r.quantity) < 1e-6) ?? (sales.length === 1 ? sales[0] : undefined)
    return {
      id: `${r.ticker}:${r.date}:${i}`,
      user_id: userId,
      ticker: r.ticker,
      open_date: open,
      close_date: r.date,
      days_held: Math.round((toMs(r.date) - toMs(open)) / 86_400_000),
      avg_cost: r.quantity > 0 ? r.invested / r.quantity : 0,
      close_price: sale ? Number(sale.price) : r.quantity > 0 ? r.proceeds / r.quantity : 0,
      quantity: r.quantity,
      invested: r.invested,
      proceeds: r.proceeds,
      pnl: r.pnl,
      pnl_pct: r.invested > 0 ? r.pnl / r.invested : 0,
      created_at: r.date,
    }
  })
}

export interface PortfolioNow {
  stockPositions: Position[]
  onPositions: ONPosition[]
  stockClosedTrades: ClosedTrade[]
  onClosedTrades: ClosedTrade[]
  cashBalance: number
}

export function portfolioNowFrom(userId: string, ledger: UserLedger, state: LedgerState): PortfolioNow {
  const closed = closedTradesOf(userId, ledger.trades, state.realized)
  const isOn = new Set(state.realized.map((r, i) => (r.assetType === 'ON' ? i : -1)))
  return {
    stockPositions: toPositions(userId, state.holdings, 'STOCK'),
    onPositions: toPositions(userId, state.holdings, 'ON'),
    stockClosedTrades: closed.filter((_, i) => !isOn.has(i)),
    onClosedTrades: closed.filter((_, i) => isOn.has(i)),
    cashBalance: state.cash,
  }
}

/** One user's portfolio now, through the caller's client (RLS applies). */
export async function loadPortfolioNow(sb: SupabaseClient, userId: string, today: string): Promise<PortfolioNow> {
  const ledger = await loadLedger(sb, userId)
  const schedules = await loadSchedules(sb, onTickersOf(ledger.trades), today)
  return portfolioNowFrom(userId, ledger, ledgerNowFrom(ledger, schedules, today))
}

/**
 * Last recorded ON closes for the positions that have no live quote, taken since the
 * position was bought (S3: before its first trade, the purchase price stands). Stocks get
 * none here.
 */
// ponytail: a stock without a live quote goes straight to cost: its last close needs Yahoo
// bars + the CCL (derived-series). The Redis LKP quote already holds the last traded price;
// add bars here if stocks with no LKP quote become common. The ex-payment adjustment
// derive-history applies to a stale ON close is not applied here either.
export async function loadLastCloses(
  sb: SupabaseClient,
  onPositions: Array<{ ticker: string; first_bought: string | null }>,
  quotes: Map<string, Quote>
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const unpriced = onPositions.filter(p => !(Number(quotes.get(p.ticker)?.price) > 0))
  await Promise.all(unpriced.map(async p => {
    try {
      const { data, error } = await sb.from('on_price_history').select('close')
        .eq('ticker', p.ticker).gte('price_date', p.first_bought ?? '0000-01-01')
        .order('price_date', { ascending: false }).limit(1)
      if (error) throw normalizeError(error)
      const close = Number(data?.[0]?.close)
      if (close > 0) out.set(p.ticker, close)
    } catch (err) {
      // Best effort: the rule's last tier (cost) covers it.
      console.warn(`[ledger-now] last close unreadable for ${p.ticker}:`, err instanceof Error ? err.message : err)
    }
  }))
  return out
}

/** Distinct stock tickers any user holds now (service client, worker only). Stocks need no schedules. */
export async function loadHeldStockTickers(sb: SupabaseClient): Promise<string[]> {
  const held = new Set<string>()
  ;(await loadAllLedgers(sb)).forEach(l => {
    for (const h of ledgerAt(l.trades, [], NO_DATE_CUTOFF).holdings) if (h.assetType === 'STOCK') held.add(h.ticker)
  })
  return [...held]
}
