// src/lib/derive-history.ts
/**
 * The portfolio history as a formula (odd/tasks/nucleo-ledger.md T4.1): ledger +
 * market data in, one snapshot-shaped row per market day out. Pure — no DB, no
 * network, never throws.
 *
 * Every day, today included, is ledgerAt(date): holdings, cost, cash and the
 * automatic ON coupons/amortizations all come from the core, never from here.
 * The only thing added is the valuation, ONE rule for every asset (S3): the last
 * close on or before the day, taken since the holding was bought; with none, the
 * holding's own cost. Today prefers the live quote.
 *
 * WORKER-SAFE: relative value imports only.
 */
import type { Quote } from '@/types'
import type { DailyBar } from './historical-prices'
import type { FlowRow } from './on-flow-history'
import type { FlowTransaction, IncomeMovement } from './asset-universe'
import { ledgerAt, type FlowOverride, type Holding, type Income, type LedgerMovement, type LedgerState, type LedgerTrade } from './ledger-core'


/** The row shape of one day of the derived history; the history and statistics routes read it. */
export interface SnapshotRow {
  user_id: string
  snapshot_date: string
  total_value: number
  total_invested: number
  pnl: number
  pnl_pct: number
  /** Per-asset-class breakdown (total_value = stocks + ons + cash). */
  stocks_value: number
  stocks_invested: number
  ons_value: number
  ons_invested: number
  cash_value: number
}

export type DerivedRow = SnapshotRow

export interface DeriveFlags {
  /** Worst day the cash sits below -$1 (funding side missing), else null. */
  negativeCash: { date: string; cash: number } | null
  /** Stocks held with no bars at all — valued at cost on every day. */
  costMarkedStocks: string[]
  /** Holdings today with no live quote (valued at their last close, else cost). */
  todayUnpriced: string[]
  /** Set when the derivation stopped early; rows hold what was computed before. */
  failure: string | null
}

export interface DeriveInput {
  userId: string
  transactions: LedgerTrade[]
  movements: LedgerMovement[]
  /** ON ticker -> payment schedule (loadSchedules). */
  schedules: Map<string, FlowRow[]>
  overrides: FlowOverride[]
  /** Portfolio ticker -> un-adjusted USD closes. Bars dated today or later are ignored. */
  barsByTicker: Map<string, DailyBar[]>
  /** ON ticker -> recorded closes (on_price_history). */
  onPricesByTicker: Map<string, DailyBar[]>
  today: string
  todayQuotes: Map<string, Quote>
}

export interface DeriveResult {
  rows: DerivedRow[]
  flags: DeriveFlags
  /** The core's ON payments up to today: what ledgerFlows declares to the risk metrics. */
  income: Income[]
}

/** $1: rounding noise vs a real missing deposit. */
const TOLERANCE = 1

const day = (d: string) => String(d).slice(0, 10)
const norm = (t: string) => String(t).trim().toUpperCase()

function indexBars(...sources: Map<string, DailyBar[]>[]): Map<string, DailyBar[]> {
  const out = new Map<string, DailyBar[]>()
  for (const src of sources) src.forEach((bars, t) => out.set(norm(t), [...(out.get(norm(t)) ?? []), ...bars]))
  return out
}

/**
 * The latest close in [since, date], or null. An ON close taken before a payment that
 * was made by `date` still includes what was paid (the bond has not traded since), so
 * it is taken ex-payment: minus the coupon and the amortized share of the price. That
 * keeps cash and bond value moving together instead of a false gain until the next trade.
 */
// ponytail: a close dated between the ex-date and the payment day is treated as cum-payment;
// exact ex-dates per bond would remove that one-day edge.
function lastClose(bars: DailyBar[] | undefined, date: string, since: string, flows: FlowRow[] = []): number | null {
  let best: DailyBar | null = null
  for (const b of bars ?? []) {
    if (b.date >= since && b.date <= date && b.close > 0 && (!best || b.date > best.date)) best = b
  }
  if (!best) return null
  let price = best.close
  let residual = 100
  for (const f of [...flows].sort((a, b) => a.date.localeCompare(b.date))) {
    if (f.date > best.date && f.date <= date) price -= f.ren + f.amo * (price / residual)
    if (f.date > best.date) residual -= f.amo
  }
  return price
}

function rowAt(userId: string, date: string, state: LedgerState, price: (h: Holding) => number | null): DerivedRow {
  let stocksValue = 0, stocksInvested = 0, onsValue = 0, onsInvested = 0
  for (const h of state.holdings) {
    const p = price(h)
    const value = p !== null ? h.quantity * p : h.costBasis
    if (h.assetType === 'ON') { onsValue += value; onsInvested += h.costBasis } else { stocksValue += value; stocksInvested += h.costBasis }
  }
  const invested = stocksInvested + onsInvested
  const pnl = stocksValue + onsValue - invested
  return {
    user_id: userId,
    snapshot_date: date,
    // total_value includes cash; total_invested deliberately does not (same as the snapshot rows)
    total_value: stocksValue + onsValue + state.cash,
    total_invested: invested,
    pnl,
    pnl_pct: invested > 0 ? pnl / invested : 0,
    stocks_value: stocksValue,
    stocks_invested: stocksInvested,
    ons_value: onsValue,
    ons_invested: onsInvested,
    cash_value: state.cash,
  }
}

export function deriveHistory(input: DeriveInput): DeriveResult {
  const flags: DeriveFlags = { negativeCash: null, costMarkedStocks: [], todayUnpriced: [], failure: null }
  const rows: DerivedRow[] = []
  let income: Income[] = []

  try {
    const { userId, transactions, movements, schedules, overrides, barsByTicker, onPricesByTicker, today, todayQuotes } = input
    const ledgerDays = [...transactions, ...movements].map(r => day(r.date)).sort()
    if (ledgerDays.length === 0) return { rows, flags, income }
    const firstDate = ledgerDays[0]

    const closes = indexBars(barsByTicker, onPricesByTicker)
    const calendar = new Set<string>()
    closes.forEach(bars => bars.forEach(b => { if (b.date >= firstDate && b.date < today) calendar.add(b.date) }))

    const options = { schedules, overrides }
    const noBars = new Set<string>()
    for (const date of [...calendar].sort()) {
      const state = ledgerAt(transactions, movements, date, options)
      for (const h of state.holdings) if (h.assetType === 'STOCK' && !closes.get(h.ticker)?.length) noBars.add(h.ticker)
      rows.push(rowAt(userId, date, state, h => lastClose(closes.get(h.ticker), date, h.firstBought, schedules.get(h.ticker))))
    }

    const now = ledgerAt(transactions, movements, today, options)
    const live = new Map(Array.from(todayQuotes, ([t, q]) => [norm(t), Number(q?.price)]))
    flags.todayUnpriced = now.holdings.filter(h => !(live.get(h.ticker)! > 0)).map(h => h.ticker)
    rows.push(rowAt(userId, today, now, h =>
      live.get(h.ticker)! > 0 ? live.get(h.ticker)! : lastClose(closes.get(h.ticker), today, h.firstBought, schedules.get(h.ticker))))
    income = now.income

    for (const r of rows) {
      if (r.cash_value < -TOLERANCE && (!flags.negativeCash || r.cash_value < flags.negativeCash.cash)) {
        flags.negativeCash = { date: r.snapshot_date, cash: r.cash_value }
      }
    }
    flags.costMarkedStocks = [...noBars].sort()
  } catch (err) {
    flags.failure = err instanceof Error ? err.message : String(err)
  }

  return { rows, flags, income }
}

/**
 * The core's ON payments as the flows the risk metrics declare (asset-universe):
 * a coupon is CUPON income (ONs -> cash); an amortization returns capital, which
 * crosses the universe boundaries exactly like an ON sale of that amount.
 */
export function ledgerFlows(income: Income[]): { income: IncomeMovement[]; transactions: FlowTransaction[] } {
  return {
    income: income.filter(i => i.kind === 'coupon').map(i => ({ date: i.date, type: 'CUPON' as const, amount: i.amount })),
    transactions: income.filter(i => i.kind === 'amortization').map(i => ({
      date: i.date, operation: 'VENTA', quantity: 1, price: i.amount, commission: 0, asset_type: 'ON',
    })),
  }
}
