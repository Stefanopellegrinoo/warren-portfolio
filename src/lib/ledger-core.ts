/**
 * The ledger core (odd/tasks/nucleo-ledger.md T2.1): the one implementation of
 * holdings, running average cost, realized trades and cash at any date. "Today"
 * and every past day are the same function with a different date.
 *
 * Rules, in one place:
 * - Order: day, then insertion time, then COMPRA before VENTA (when insertion ties
 *   there is no information left; the buy-first choice bounds the error instead of
 *   fabricating a position that never closes).
 * - COMPRA adds qty × price + commission to the cost. VENTA keeps the average,
 *   removes qty × average from the cost, and realizes proceeds = qty × price − commission.
 * - Selling more than held sells what was held and is reported as an issue.
 * - A holding below DUST, or below RESIDUE of the most it held since it opened (CEDEAR
 *   conversion rounding: 114.67 bought, 2 × 57.333333 sold), is closed; the next buy starts
 *   a new cost and first-bought date.
 * - Routes by asset_type ('ON' vs everything else), never by ticker suffix.
 * - Trades are stored as traded (odd/tasks/split-aware-ledger.md S2). A stock split
 *   applies at the start of its date, before that day's trades: the quantity is
 *   multiplied by numerator/denominator and the cost stays, so the average divides.
 * - ON payments (odd/tasks/nucleo-ledger.md T3.1) come from the bond schedule, per 100
 *   original VN: the holder at the close of the business day before the payment date is
 *   paid quantity × (ren + amo) (quantity is VN/100). An amortization is a return of
 *   capital: the cost drops by amo / residual-before; the quantity does not change,
 *   because prices are quoted on the original VN. A user override replaces the amount
 *   or marks the payment not received.
 *
 * WORKER-SAFE: pure, relative imports only.
 */
import { cashDelta } from './cash-signs'
import { addBusinessDays } from './ar-calendar'
import type { FlowRow } from './on-flow-history'
import type { SplitEvent } from './historical-prices'

const DUST = 0.0001
const RESIDUE = 1e-4

export interface LedgerTrade {
  ticker: string
  operation: string
  quantity: number
  price: number
  commission: number | null
  /** YYYY-MM-DD, possibly with a timestamp suffix. */
  date: string
  asset_type: string | null
  created_at: string | null
}

export interface LedgerMovement {
  type: string
  amount: number
  date: string
}

export type AssetKind = 'ON' | 'STOCK'

export interface Holding {
  ticker: string
  assetType: AssetKind
  quantity: number
  avgCost: number
  costBasis: number
  firstBought: string
}

const peaks = new WeakMap<Holding, number>()

export interface Realized {
  ticker: string
  assetType: AssetKind
  date: string
  quantity: number
  invested: number
  proceeds: number
  pnl: number
}

export type LedgerIssue = { kind: 'oversell'; ticker: string; date: string; requested: number; held: number }

export type PaymentKind = 'coupon' | 'amortization'

export interface FlowOverride {
  ticker: string
  date: string
  kind: PaymentKind
  /** null = not received. */
  amount: number | null
}

export interface Income {
  ticker: string
  date: string
  kind: PaymentKind
  amount: number
  source: 'schedule' | 'user'
}

export interface LedgerOptions {
  /** ON ticker (D line, upper case) → its payment schedule. */
  schedules?: Map<string, FlowRow[]>
  overrides?: FlowOverride[]
  /** Ledger ticker (upper case) → its stock splits. */
  splits?: Map<string, SplitEvent[]>
}

export interface LedgerState {
  holdings: Holding[]
  realized: Realized[]
  income: Income[]
  cash: number
  issues: LedgerIssue[]
}

const dayOf = (date: string) => String(date).slice(0, 10)

/** Per 100 original VN from a schedule, or an absolute amount the user entered for a payment no source has. */
type PayAmount = { per100: number } | { fixed: number }

type Event =
  | { kind: 'trade'; day: string; created: string; rank: number; t: LedgerTrade }
  | { kind: 'pay'; day: string; created: string; rank: number; ticker: string; date: string; coupon: PayAmount; amortization: PayAmount; residualBefore: number }
  | { kind: 'split'; day: string; created: string; rank: number; ticker: string; factor: number }

const LAST = '\uffff' // a payment is settled after every trade of its record day

function paymentEvents(schedules: Map<string, FlowRow[]>, overrides: FlowOverride[], cutoff: string): Event[] {
  const out: Event[] = []
  const event = (ticker: string, date: string, coupon: PayAmount, amortization: PayAmount, residualBefore: number): Event =>
    ({ kind: 'pay', day: addBusinessDays(date, -1), created: LAST, rank: 2, ticker, date, coupon, amortization, residualBefore })
  const residualAt = (flows: FlowRow[], date: string) => 100 - flows.filter(f => f.date < date).reduce((sum, f) => sum + f.amo, 0)

  schedules.forEach((flows, ticker) => {
    for (const flow of flows) {
      if (flow.date <= cutoff) out.push(event(ticker, flow.date, { per100: flow.ren }, { per100: flow.amo }, residualAt(flows, flow.date)))
    }
  })
  // Payments the user entered on a date no schedule lists (S8): one event per ticker and date.
  const extra = new Map<string, { ticker: string; date: string; coupon: number; amortization: number }>()
  for (const o of overrides) {
    const ticker = o.ticker.toUpperCase()
    const listed = (schedules.get(ticker) ?? []).some(f => f.date === o.date)
    if (listed || o.date > cutoff || !(o.amount && o.amount > 0)) continue
    const key = `${ticker}|${o.date}`
    const e = extra.get(key) ?? { ticker, date: o.date, coupon: 0, amortization: 0 }
    e[o.kind === 'coupon' ? 'coupon' : 'amortization'] += o.amount
    extra.set(key, e)
  }
  extra.forEach(e => out.push(event(e.ticker, e.date, { fixed: e.coupon }, { fixed: e.amortization }, residualAt(schedules.get(e.ticker) ?? [], e.date))))
  return out
}

export function ledgerAt(trades: LedgerTrade[], movements: LedgerMovement[], date: string, options: LedgerOptions = {}): LedgerState {
  const cutoff = dayOf(date)
  const open = new Map<string, Holding>()
  const kinds = new Map<string, AssetKind>()
  const realized: Realized[] = []
  const income: Income[] = []
  const issues: LedgerIssue[] = []
  const override = new Map((options.overrides ?? []).map(o => [`${o.ticker.toUpperCase()}|${o.date}|${o.kind}`, o.amount]))

  // A row carrying the type wins over one that omits it, wherever it sits.
  for (const t of trades) {
    const key = t.ticker.trim().toUpperCase()
    if (t.asset_type) kinds.set(key, t.asset_type.toUpperCase() === 'ON' ? 'ON' : kinds.get(key) ?? 'STOCK')
  }

  const events: Event[] = [
    ...trades
      .filter(t => dayOf(t.date) <= cutoff)
      .map((t): Event => ({ kind: 'trade', day: dayOf(t.date), created: String(t.created_at ?? ''), rank: t.operation === 'COMPRA' ? 0 : 1, t })),
    ...paymentEvents(options.schedules ?? new Map(), options.overrides ?? [], cutoff),
    // Empty insertion time and rank -1: a split goes before every trade of its day.
    ...Array.from(options.splits ?? new Map<string, SplitEvent[]>()).flatMap(([ticker, splits]) => splits
      .filter(sp => sp.date <= cutoff)
      .map((sp): Event => ({ kind: 'split', day: sp.date, created: '', rank: -1, ticker: ticker.trim().toUpperCase(), factor: sp.numerator / sp.denominator }))),
  ].sort((a, b) => a.day.localeCompare(b.day) || a.created.localeCompare(b.created) || a.rank - b.rank)

  const pay = (ticker: string, payDate: string, kind: PaymentKind, computed: number, fromUser: boolean): number => {
    const key = `${ticker}|${payDate}|${kind}`
    const user = fromUser || override.has(key)
    const amount = override.has(key) ? override.get(key)! : computed
    if (amount === null || !(amount > 0)) return 0
    income.push({ ticker, date: payDate, kind, amount, source: user ? 'user' : 'schedule' })
    return amount
  }
  const amountOf = (a: PayAmount, quantity: number) => ('fixed' in a ? a.fixed : quantity * a.per100)

  for (const e of events) {
    if (e.kind === 'split') {
      const h = open.get(e.ticker)
      if (!h || !(e.factor > 0) || !Number.isFinite(e.factor)) continue
      h.quantity *= e.factor
      h.avgCost = h.costBasis / h.quantity
      peaks.set(h, (peaks.get(h) ?? 0) * e.factor)
      continue
    }
    if (e.kind === 'pay') {
      const h = open.get(e.ticker)
      if (!h) continue
      const fromUser = 'fixed' in e.coupon
      pay(e.ticker, e.date, 'coupon', amountOf(e.coupon, h.quantity), fromUser)
      const returned = pay(e.ticker, e.date, 'amortization', amountOf(e.amortization, h.quantity), fromUser)
      if (returned > 0) {
        // Share of the remaining capital returned: amount over quantity × residual (both per 100 original VN).
        h.costBasis -= h.costBasis * Math.min(1, returned / (h.quantity * e.residualBefore))
        h.avgCost = h.costBasis / h.quantity
      }
      continue
    }

    const t = e.t
    const day = e.day
    const ticker = t.ticker.trim().toUpperCase()
    const assetType = kinds.get(ticker) ?? 'STOCK'
    const qty = Math.abs(t.quantity)
    const commission = t.commission ?? 0
    const h = open.get(ticker)

    if (t.operation === 'COMPRA') {
      const next = h ?? { ticker, assetType, quantity: 0, avgCost: 0, costBasis: 0, firstBought: day }
      next.costBasis += qty * t.price + commission
      next.quantity += qty
      next.avgCost = next.costBasis / next.quantity
      peaks.set(next, Math.max(peaks.get(next) ?? 0, next.quantity))
      open.set(ticker, next)
    } else if (t.operation === 'VENTA') {
      const held = h?.quantity ?? 0
      if (qty > held + DUST) issues.push({ kind: 'oversell', ticker, date: day, requested: qty, held })
      const sold = Math.min(qty, held)
      if (!h || sold <= 0) continue
      const invested = sold * h.avgCost
      const proceeds = sold * t.price - commission
      realized.push({ ticker, assetType, date: day, quantity: sold, invested, proceeds, pnl: proceeds - invested })
      h.quantity -= sold
      h.costBasis -= invested
      if (h.quantity < Math.max(DUST, (peaks.get(h) ?? 0) * RESIDUE)) open.delete(ticker)
    }
  }

  let cash = income.reduce((sum, i) => sum + i.amount, 0)
  for (const m of movements) if (dayOf(m.date) <= cutoff) cash += cashDelta(m.type, m.amount)

  return { holdings: [...open.values()], realized, income, cash, issues }
}
