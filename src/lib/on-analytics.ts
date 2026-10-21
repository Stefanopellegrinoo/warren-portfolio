// Read-time analytics for one ON (pure: no DB, no network). Combines the stored
// catalog row, raw BYMA flows, curated overrides and a live D-line price.
// Nothing here is persisted (R3.10). Yields are returned in percent (6.09 = 6.09%).
import { actualDays, buildFlows, type Bdc, type DayCount, type Flow, type RawFlow } from './bond-math'
import { analyze } from './bond-yield'
import { interpolateSpread, yieldToWorst, type CallWindow } from './bond-options'
import { arCalendar } from './ar-calendar'
import { resolveTerms, type F, type OverrideRow, type Plaza, type Put, type ResolvedTerms } from './on-terms'

export type RateType = 'fixed' | 'step' | 'zero' | 'floating' | 'other'

export const FLAG_BP = 5 // method check: |diff| above this is flagged (same as the ingest)
export const TERMS_NOTE_MIN_BP = 1 // below this the convention difference is noise
export const SHORT_DATED_DAYS = 90 // under this the yield is hypersensitive to price (same cut as the daily check)

export interface TermsRow {
  isin: string
  tickerO: string
  tickerD: string | null
  tickerC: string | null
  issuer: string | null
  description: string | null
  law: 'ARG' | 'NY'
  currency: string
  paymentPlaza: Plaza | null
  est: string | null
  frequency: string | null
  issueDate: string
  maturityDate: string
  couponRate: number | null // fraction, BYMA cup
  residualPct: number
  accrualStart: string
  issuedAmountByma: number | null
  adtvO: number | null
  adtvD: number | null
  adtvC: number | null
  asOf: string
}

export interface CheckRow {
  asOf: string
  bymaYtmPct: number | null
  methodYtmPct: number | null
  methodDiffBp: number | null
  termsYtmPct: number | null
  termsDiffBp: number | null
  flagged: boolean
}

export interface EventRow {
  kind: string
  eventDate: string
  note: string | null
  sourceUrl: string
  verifiedAt: string | null
}

export interface SovPoint {
  law: 'ARG' | 'NY'
  ytmPct: number
  dm: number
}

export interface Line {
  px: number
  v: number | null // data912 volume today (0 = no trades, null = unknown)
}
export type LineSet = { D?: Line; C?: Line; O?: Line } // O is in pesos
export interface PickedLine {
  line: 'D' | 'C' | 'O' // O = implied cable price: O (ARS) price ÷ CCL
  price: number
  noTrades: boolean
  fellBack: boolean
}

// BYMA converts the O (ARS) price with the FX of the bond's payment plaza, so a cable-paying
// ON is priced like BYMA does. Order for CCL: traded C line, then the implied cable price
// (O ÷ CCL, as BYMA computes it), then the D line (ignores the canje), then any priced line
// flagged as no-trades. MEP (or unknown plaza) ONs use D then C: there is no MEP rate source for an implied price.
// `quiet` comes from D-line volumes (see loadOnAnalyses).
export function pickPriceLine(plaza: Plaza | null, lines: LineSet, quiet: boolean, ccl: number | null = null): PickedLine | null {
  const cclOk = ccl !== null && Number.isFinite(ccl) && ccl > 0
  // Unknown volume on C/O is NOT evidence of trades in an active session; on D it is tolerated.
  const trades = (l: Line | undefined, line: 'D' | 'C' | 'O') => !!l && (quiet || (line === 'D' ? l.v !== 0 : (l.v ?? 0) > 0))
  const cand = (line: 'D' | 'C' | 'O', fellBack: boolean): PickedLine | null => {
    const l = lines[line]
    if (!l || !(l.px > 0)) return null
    if (line === 'O') return cclOk ? { line, price: l.px / ccl!, noTrades: !trades(l, line), fellBack } : null
    return { line, price: l.px, noTrades: !trades(l, line), fellBack }
  }
  const order: PickedLine[] = (plaza === 'CCL' ? [cand('C', false), cand('O', true), cand('D', true)] : [cand('D', false), cand('C', true)]).filter((c): c is PickedLine => c !== null)
  const pick = order.find((c) => !c.noTrades) ?? order[0]
  return pick ?? null
}

export interface OnInput {
  terms: TermsRow
  flows: RawFlow[]
  overrides: OverrideRow[]
  events: EventRow[]
  check: CheckRow | null
  curve: SovPoint[]
  price: number | null // D line, dirty, per 100 VN (data912 c is dirty)
  lines?: LineSet // when given, the price is picked by payment plaza (overrides `price`)
  ccl?: { rate: number; at: string } | null // CCL for the implied cable price (O ÷ CCL)
  quiet?: boolean // the feed does not look like an active session
  noTrades?: boolean // data912 reports zero volume on the D line today: `c` is only a reference
  settle: string
}

export type OnStatus = 'ok' | 'no-price' | 'floating' | 'no-yield'

export interface MethodFlag {
  bymaYtmPct: number | null
  methodYtmPct: number | null
  diffBp: number
  asOf: string
}

export interface TermsNote {
  bymaYtmPct: number | null
  termsYtmPct: number | null
  diffBp: number
  asOf: string
}

export interface OnListRow {
  isin: string
  tickerO: string
  tickerD: string | null
  issuer: string | null
  description: string | null
  currency: string
  currencyLabel: string
  plaza: Plaza | null
  law: 'ARG' | 'NY'
  rateType: RateType
  maturityDate: string
  shortDated: boolean
  priceQuality: 'ok' | 'no-trades'
  priceLine: 'D' | 'C' | 'O' | null // which line the price comes from (O = implied, O ÷ CCL)
  cclUsed: { rate: number; asOf: string } | null // set when priceLine is O
  lineFallback: boolean // the other line was used (not the one matching the payment plaza)
  bymaYtm: { pct: number; asOf: string } | null // BYMA's own TIR (peso price / MEP), for comparison
  status: OnStatus
  simulable: boolean
  price: number | null
  ytmPct: number | null
  mdYears: number | null
  paridadPct: number | null
  currentYieldPct: number | null
  walYears: number | null
  spreadBp: number | null
  adtvUsd: number | null
  nextPayDate: string | null
  nextPayAmountPct: number | null
  methodFlag: MethodFlag | null
  termsNote: TermsNote | null
  events: EventRow[]
}

export interface ScheduleRow {
  date: string
  payDate: string
  couponPct: number | null // null for floating: BYMA coupon estimates are not shown
  amortPct: number
  residualBeforePct: number
}

export interface OnDetail {
  issueDate: string
  accrualStart: string // start of the accrual period of the first listed flow (accrued-interest base)
  couponRatePct: number | null
  frequency: string | null
  residualPct: number
  tickerC: string | null
  asOf: string
  macaulayYears: number | null
  convexity: number | null
  accrued: number | null
  clean: number | null
  ytw: { ytwPct: number; workoutDate: string; kind: 'maturity' | 'call' } | null
  schedule: ScheduleRow[]
  terms: {
    dayCount: F<DayCount>
    bdc: F<Bdc>
    maturityBdc: F<Bdc>
    recordOffsetDays: F<number | null>
    paymentPlaza: F<Plaza | null>
    minDenomination: F<number | null>
    minTradeUnit: F<number | null>
    increment: F<number | null>
    issuedAmount: F<number | null>
    issuedAmountByma: number | null
    calls: F<CallWindow[]>
    puts: F<Put[]>
  }
  warnings: ResolvedTerms['warnings']
}

export interface OnAnalysis {
  row: OnListRow
  detail: OnDetail
}

const RATE_TYPES: Record<string, RateType> = {
  'Tasa Fija': 'fixed',
  'Step Up': 'step',
  'Cupon Cero': 'zero',
  'Tasa Variable': 'floating',
}

export function rateTypeOf(est: string | null): RateType {
  return (est && RATE_TYPES[est]) || 'other'
}

export function currencyLabel(currency: string, plaza: Plaza | null): string {
  if (currency !== 'USD') return currency
  return plaza === 'MEP' ? 'USD MEP' : plaza === 'CCL' ? 'USD cable' : 'USD'
}

const sumKnown = (xs: (number | null)[]): number | null => {
  const known = xs.filter((x): x is number => x !== null)
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0)
}

function toFlows(t: TermsRow, rt: RateType, r: ResolvedTerms, raw: RawFlow[]): Flow[] {
  const fixed = rt === 'fixed' && t.couponRate !== null && t.couponRate > 0
  try {
    return buildFlows(
      {
        issueDate: t.issueDate,
        accrualStart: t.accrualStart,
        residualPct: t.residualPct,
        rateType: fixed ? 'fixed' : 'byma',
        couponPct: (t.couponRate ?? 0) * 100,
        dayCount: r.dayCount.value,
        bdc: r.bdc.value,
        maturityBdc: r.maturityBdc.value,
        recordOffsetDays: r.recordOffsetDays.value,
      },
      raw
    )
  } catch {
    return []
  }
}

const noAnalytics = {
  price: null,
  ytmPct: null,
  mdYears: null,
  paridadPct: null,
  currentYieldPct: null,
  walYears: null,
  spreadBp: null,
} as const

function disclosure(check: CheckRow | null): { methodFlag: MethodFlag | null; termsNote: TermsNote | null } {
  if (!check) return { methodFlag: null, termsNote: null }
  const flagged = check.methodDiffBp !== null && Math.abs(check.methodDiffBp) > FLAG_BP
  const termsDiff = check.termsDiffBp
  return {
    methodFlag: flagged
      ? { bymaYtmPct: check.bymaYtmPct, methodYtmPct: check.methodYtmPct, diffBp: check.methodDiffBp!, asOf: check.asOf }
      : null,
    // Informational only: our resolved terms differ from BYMA's convention.
    termsNote:
      !flagged && termsDiff !== null && Math.abs(termsDiff) >= TERMS_NOTE_MIN_BP
        ? { bymaYtmPct: check.bymaYtmPct, termsYtmPct: check.termsYtmPct, diffBp: termsDiff, asOf: check.asOf }
        : null,
  }
}

export function analyzeOn(i: OnInput): OnAnalysis {
  const { terms: t, settle } = i
  const rt = rateTypeOf(t.est)
  const floating = rt === 'floating'
  const resolved = resolveTerms({ isin: t.isin, law: t.law, paymentPlaza: t.paymentPlaza, issuedAmountByma: t.issuedAmountByma }, i.overrides)
  const flows = toFlows(t, rt, resolved, i.flows)
  const next = flows.find((f) => f.date > settle)
  // Price currency must match the flow currency: only USD ONs take the D-line price.
  const picked = i.lines ? pickPriceLine(resolved.paymentPlaza.value, i.lines, i.quiet ?? false, i.ccl?.rate ?? null) : i.price !== null && i.price > 0 ? { line: 'D' as const, price: i.price, noTrades: i.noTrades ?? false, fellBack: false } : null
  const usable = !floating && t.currency === 'USD' ? picked : null
  const px = usable?.price ?? null

  const a = px === null ? null : analyze({
    dirtyPx: px,
    flows,
    settle,
    dayCount: resolved.dayCount.value,
    issueDate: t.accrualStart,
    couponPct: rt === 'fixed' ? (t.couponRate ?? 0) * 100 : 0,
    floating,
  })
  const ok = a && a.ok ? a : null
  const status: OnStatus = floating ? 'floating' : px === null ? 'no-price' : ok ? 'ok' : 'no-yield'

  const spread = ok
    ? interpolateSpread(
        ok.ytm,
        ok.modified,
        i.curve.filter((p) => p.law === t.law).map((p) => ({ duration: p.dm, ytm: p.ytmPct / 100 }))
      )
    : null
  const worst = ok && resolved.calls.value.length > 0
    ? yieldToWorst(ok.dirty, flows, resolved.calls.value, settle, resolved.dayCount.value, t.accrualStart, { bdc: resolved.bdc.value, cal: arCalendar })
    : null
  const { methodFlag, termsNote } = disclosure(i.check)

  const row: OnListRow = {
    isin: t.isin,
    tickerO: t.tickerO,
    tickerD: t.tickerD,
    issuer: t.issuer,
    description: t.description,
    currency: t.currency,
    currencyLabel: currencyLabel(t.currency, resolved.paymentPlaza.value),
    plaza: resolved.paymentPlaza.value,
    law: t.law,
    rateType: rt,
    maturityDate: t.maturityDate,
    shortDated: actualDays(settle, t.maturityDate) < SHORT_DATED_DAYS,
    priceQuality: usable?.noTrades ? 'no-trades' : 'ok',
    priceLine: usable?.line ?? null,
    cclUsed: usable?.line === 'O' && i.ccl ? { rate: i.ccl.rate, asOf: i.ccl.at } : null,
    lineFallback: usable?.fellBack ?? false,
    bymaYtm: i.check && i.check.bymaYtmPct !== null ? { pct: i.check.bymaYtmPct, asOf: i.check.asOf } : null,
    status,
    // R3.3: floating ONs cannot be simulated; the rest of the catalog can when it is a USD fixed-rate ON.
    simulable: t.currency === 'USD' && rt === 'fixed',
    ...noAnalytics,
    adtvUsd: sumKnown([t.adtvO, t.adtvD, t.adtvC]),
    nextPayDate: next?.payDate ?? null,
    nextPayAmountPct: next ? next.couponPct + next.amortPct : null,
    methodFlag,
    termsNote,
    events: [...i.events].sort((x, y) => y.eventDate.localeCompare(x.eventDate)),
  }
  if (ok) {
    row.price = px
    row.ytmPct = ok.ytm * 100
    row.mdYears = ok.modified
    row.paridadPct = ok.paridad * 100
    // Current yield needs a stated coupon rate; step-up and zero-coupon have none.
    row.currentYieldPct = rt === 'fixed' ? ok.currentYield * 100 : null
    row.walYears = ok.wal
    row.spreadBp = spread === null ? null : spread * 10000
  }

  const detail: OnDetail = {
    issueDate: t.issueDate,
    accrualStart: t.accrualStart,
    couponRatePct: t.couponRate === null ? null : t.couponRate * 100,
    frequency: t.frequency,
    residualPct: t.residualPct,
    tickerC: t.tickerC,
    asOf: t.asOf,
    macaulayYears: ok?.macaulay ?? null,
    convexity: ok?.convexity ?? null,
    accrued: ok?.accrued ?? null,
    clean: ok?.clean ?? null,
    ytw: worst ? { ytwPct: worst.ytw * 100, workoutDate: worst.workoutDate, kind: worst.kind } : null,
    schedule: flows.map((f) => ({
      date: f.date,
      payDate: f.payDate,
      couponPct: floating ? null : f.couponPct,
      amortPct: f.amortPct,
      residualBeforePct: f.residualBeforePct,
    })),
    terms: {
      dayCount: resolved.dayCount,
      bdc: resolved.bdc,
      maturityBdc: resolved.maturityBdc,
      recordOffsetDays: resolved.recordOffsetDays,
      paymentPlaza: resolved.paymentPlaza,
      minDenomination: resolved.minDenomination,
      minTradeUnit: resolved.minTradeUnit,
      increment: resolved.increment,
      issuedAmount: resolved.issuedAmount,
      issuedAmountByma: resolved.issuedAmountByma,
      calls: resolved.calls,
      puts: resolved.puts,
    },
    warnings: resolved.warnings,
  }
  return { row, detail }
}
