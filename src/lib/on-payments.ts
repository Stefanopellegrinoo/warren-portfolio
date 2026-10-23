/**
 * ONs → Mi cartera, "Pagos cobrados" (odd/tasks/nucleo-ledger.md S4, S8, S10): every coupon
 * and amortization the ledger core paid, newest first, with the user's corrections; and the
 * payments the bond's own calendar says had to exist while the user held it but no source
 * covers, with an estimate when one can be made. The app never invents those: it asks.
 *
 * `buildPayments` is pure; `loadPayments` reads the ledger with the user's client (RLS) and
 * on_terms, a market table, with the service role (odd/tasks/security-hardening.md S12).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeError } from './errors'
import { addBusinessDays } from './ar-calendar'
import { PERIOD_MONTHS } from './byma-educa'
import { ledgerAt, type FlowOverride, type LedgerTrade, type PaymentKind } from './ledger-core'
import { scheduleGaps, type FlowRow, type GapTerms } from './on-flow-history'
import { loadSchedules } from './on-schedules'
import { loadOverrides } from './ledger-now'
import { createServiceClient } from './supabase-server'

export interface PaymentLine {
  ticker: string
  date: string
  kind: PaymentKind
  /** null = the user said it was not received. */
  amount: number | null
  /** The user's word replaces the schedule (an amount, "No lo cobré", or a payment the app asked for). */
  corrected: boolean
}

export interface MissingPayment {
  date: string
  estimate: number | null
}

export interface MissingGroup {
  ticker: string
  payments: MissingPayment[]
}

export interface PaymentTerms extends GapTerms {
  /** Ledger ticker (D line). */
  ticker: string
  /** Fraction (0.0725 = 7.25%). */
  couponRate: number | null
}

export interface PaymentsInput {
  trades: LedgerTrade[]
  schedules: Map<string, FlowRow[]>
  overrides: FlowOverride[]
  terms: PaymentTerms[]
  today: string
}

const norm = (t: string) => t.trim().toUpperCase()
const round2 = (x: number) => Math.round(x * 100) / 100

// ponytail: fixed rate × current residual × the period; ignores day count, a residual that
// amortized since that date and an irregular first period. It only pre-fills a form the user
// confirms; use the bond's day count and the residual at the date if estimates must be exact.
function estimate(terms: PaymentTerms, quantity: number): number | null {
  const months = terms.frequency ? PERIOD_MONTHS[terms.frequency] : undefined
  if (terms.est !== 'Tasa Fija' || !months || !(terms.couponRate && terms.couponRate > 0)) return null
  return round2(terms.couponRate * 100 * (months / 12) * (terms.residualPct / 100) * quantity)
}

export function buildPayments({ trades, schedules, overrides, terms, today }: PaymentsInput): { payments: PaymentLine[]; missing: MissingGroup[] } {
  const paid = ledgerAt(trades, [], today, { schedules, overrides }).income
    .map((i): PaymentLine => ({ ticker: i.ticker, date: i.date, kind: i.kind, amount: i.amount, corrected: i.source === 'user' }))
  const notReceived = overrides
    .filter(o => o.amount === null && o.date <= today)
    .map((o): PaymentLine => ({ ticker: norm(o.ticker), date: o.date, kind: o.kind, amount: null, corrected: true }))
  const payments = [...paid, ...notReceived]
    .sort((a, b) => b.date.localeCompare(a.date) || a.ticker.localeCompare(b.ticker) || a.kind.localeCompare(b.kind))

  const missing: MissingGroup[] = []
  for (const t of terms) {
    const ticker = norm(t.ticker)
    const own = trades.filter(tr => norm(tr.ticker) === ticker)
    if (own.length === 0) continue
    const from = own.map(tr => tr.date.slice(0, 10)).sort()[0]
    // A date the user already answered (an amount or "No lo cobré") is covered like a listed flow.
    const answered = overrides.filter(o => norm(o.ticker) === ticker).map((o): FlowRow => ({ date: o.date, ren: 0, amo: 0 }))
    const { missingDates } = scheduleGaps(t, [...(schedules.get(ticker) ?? []), ...answered], from, today)
    const list: MissingPayment[] = []
    for (const date of missingDates) {
      // Paid to the holder at the close of the business day before, like the core does.
      const held = ledgerAt(own, [], addBusinessDays(date, -1)).holdings.find(h => h.ticker === ticker)
      if (held) list.push({ date, estimate: estimate(t, held.quantity) })
    }
    if (list.length > 0) missing.push({ ticker, payments: list })
  }
  return { payments, missing }
}

const PAGE = 1000

async function readAll<T>(build: () => any): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += PAGE) {
    // Ordered on every page: LIMIT/OFFSET without ORDER BY can serve a row twice or never.
    const { data, error } = await build().order('id', { ascending: true }).range(offset, offset + PAGE - 1)
    if (error) throw normalizeError(error)
    rows.push(...((data ?? []) as T[]))
    if ((data ?? []).length < PAGE) return rows
  }
}

/** Reads THROW: a payment list built from half a ledger is wrong, not partial. */
export async function loadPayments(sb: SupabaseClient, userId: string, today: string) {
  const [trades, overrides] = await Promise.all([
    readAll<LedgerTrade>(() => sb.from('transactions')
      .select('ticker, operation, quantity, price, commission, date, asset_type, created_at').eq('user_id', userId)),
    loadOverrides(sb, userId),
  ])
  const onTrades = trades.filter(t => String(t.asset_type ?? '').toUpperCase() === 'ON')
  const tickers = [...new Set(onTrades.map(t => norm(t.ticker)))]
  if (tickers.length === 0) return { payments: [], missing: [] }

  const [schedules, termsRes] = await Promise.all([
    loadSchedules(sb, tickers, today),
    createServiceClient().from('on_terms').select('ticker_d, est, frequency, issue_date, accrual_start, residual_pct, coupon_rate').in('ticker_d', tickers),
  ])
  if (termsRes.error) throw normalizeError(termsRes.error)
  const terms = (termsRes.data ?? []).map((r: any): PaymentTerms => ({
    ticker: r.ticker_d, est: r.est, frequency: r.frequency, issueDate: r.issue_date, accrualStart: r.accrual_start,
    residualPct: Number(r.residual_pct ?? 100), couponRate: r.coupon_rate == null ? null : Number(r.coupon_rate),
  }))
  return buildPayments({ trades: onTrades, schedules, overrides, terms, today })
}
