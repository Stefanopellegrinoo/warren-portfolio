// Pure aggregation of a test portfolio (no DB, no network). Every ON is run through
// simulateOn (R5.5: no duplicated math); this module only combines the results.
// Portfolio YTM is the IRR of the POOLED flows against the total dirty cost, solved with
// the same ytm() as a single bond (it is NOT an average of the ONs' yields).
// Duration is market-value weighted (weight = dirty cost). USD only, no taxes or fees.
import { addDays, settlementDate } from './ar-calendar'
import type { Flow } from './bond-math'
import { risk, wal, ytm } from './bond-yield'
import type { OnAnalysis } from './on-analytics'
import { fmtDate, fmtNum, fmtVn } from './on-format'
import { flowsOf, simulateOn, type SimRefusal } from './on-simulator'
import type { Plaza } from './on-terms'

export interface PortfolioItem {
  isin: string
  mode: 'usd' | 'vn'
  amount: number
  manualPrice?: number | null
}

export type SkipReason = SimRefusal | 'unknown-isin'
export type WarningKind = 'floating' | 'not-usd' | 'no-price' | 'unknown-isin' | 'invalid' | 'lot-adjusted' | 'record-window' | 'call' | 'price-fallback' | 'reference-price'
  | 'unmapped' | 'held-record-passed' | 'day-count-unverified' | 'event'

export interface PortfolioWarning {
  kind: WarningKind
  isin: string
  message: string
}

export interface Position {
  isin: string
  ticker: string // display ticker: the D (dollar) line, or O when there is no D line
  tickerO: string
  issuer: string | null
  plaza: Plaza | null
  maturityDate: string
  vn: number
  cost: number
  weightPct: number
  pricePct: number
  ytmPct: number | null
  mdYears: number | null
  ytwKind: 'maturity' | 'call' | null
  collected: number
  priced: boolean // false: held ON without a price (no market value, no yield)
  nextPayDate: string | null // adjusted pay date of the first projected payment
  nextPayAmount: number | null
}

export interface MonthRow { month: string; interest: number; principal: number; total: number; cumulative: number }
export interface YearRow { year: number; interest: number; principal: number; total: number }
export interface LadderRow { year: number; principal: number; pct: number }
export interface IssuerRow { name: string; cost: number; pct: number }
export interface PlazaRow { plaza: Plaza | null; cost: number; costPct: number; collected: number }
export interface PortfolioPayment { isin: string; ticker: string; date: string; payDate: string; interest: number; principal: number; total: number }

export interface PortfolioAnalysis {
  empty: boolean
  settle: string
  positions: Position[]
  skipped: { isin: string; reason: SkipReason; message: string }[]
  totals: { cost: number; interest: number; principal: number; collected: number; profit: number }
  payments: PortfolioPayment[]
  monthly: MonthRow[]
  annual: YearRow[]
  next12m: { interest: number; principal: number; total: number }
  ladder: LadderRow[]
  ytmPct: number | null
  mdYears: number | null
  walYears: number | null
  issuers: IssuerRow[]
  plazas: PlazaRow[]
  warnings: PortfolioWarning[]
}

/** Same calendar day one year later (Feb 29 -> Feb 28). */
export function plusOneYear(iso: string): string {
  const y = Number(iso.slice(0, 4)) + 1
  const md = iso.slice(5)
  if (md === '02-29' && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) return `${y}-02-28`
  return `${y}-${md}`
}

export const MATURED_MESSAGE = 'La ON está vencida: ya no tiene pagos futuros'
/** No payment is left after the settlement date (the analysis drops the price of such an ON, so check this before pricing). */
export const isMatured = (a: OnAnalysis, today: string): boolean => {
  const settle = settlementDate(today)
  return a.detail.schedule.every((s) => s.date <= settle)
}

const EPS = 1e-9
const NO_ISSUER = 'Sin emisor'
const usd = (x: number) => `USD ${fmtNum(x)}`
const REASON_KIND: Record<SkipReason, WarningKind> = {
  floating: 'floating', 'not-usd': 'not-usd', 'no-price': 'no-price', 'unknown-isin': 'unknown-isin',
  'bad-amount': 'invalid', 'bad-price': 'invalid', 'below-min': 'invalid', 'no-payments': 'invalid',
}

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

/** Pooled flows as bond-math flows, one per pay date, scaled so that the price is 100 (`amountOf` / base * 100). */
function pooled(payments: PortfolioPayment[], settle: string, base: number, amountOf: (p: PortfolioPayment) => number): Flow[] {
  const byDate = new Map<string, number>()
  for (const p of payments) byDate.set(p.payDate, (byDate.get(p.payDate) ?? 0) + amountOf(p))
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([payDate, amount]) => {
      // ytm() keeps a flow iff its unadjusted date is after settlement; discounting uses payDate.
      const date = payDate > settle ? payDate : addDays(settle, 1)
      const pct = (amount / base) * 100
      return { date, payDate, recordDate: date, couponPct: 0, amortPct: pct, residualBeforePct: pct, couponSource: 'byma' as const }
    })
}

function emptyAnalysis(settle: string, skipped: PortfolioAnalysis['skipped'], warnings: PortfolioWarning[]): PortfolioAnalysis {
  return {
    empty: true, settle, positions: [], skipped,
    totals: { cost: 0, interest: 0, principal: 0, collected: 0, profit: 0 },
    payments: [], monthly: [], annual: [], next12m: { interest: 0, principal: 0, total: 0 }, ladder: [],
    ytmPct: null, mdYears: null, walYears: null, issuers: [], plazas: [], warnings,
  }
}

export function analyzePortfolio({ items, analyses, today }: { items: PortfolioItem[]; analyses: OnAnalysis[]; today: string }): PortfolioAnalysis {
  const byIsin = new Map(analyses.map((a) => [a.row.isin, a]))
  const positions: Position[] = []
  const payments: PortfolioPayment[] = []
  const skipped: PortfolioAnalysis['skipped'] = []
  const warnings: PortfolioWarning[] = []
  let settle = ''

  const skip = (isin: string, reason: SkipReason, message: string) => {
    skipped.push({ isin, reason, message })
    warnings.push({ kind: REASON_KIND[reason], isin, message })
  }

  for (const item of items) {
    const analysis = byIsin.get(item.isin)
    if (!analysis) {
      skip(item.isin, 'unknown-isin', `${item.isin}: la ON no está en el catálogo`)
      continue
    }
    const { row } = analysis
    const tk = row.tickerD ?? row.tickerO
    if (isMatured(analysis, today)) {
      skip(item.isin, 'no-payments', `${tk}: ${MATURED_MESSAGE}`)
      continue
    }
    const r = simulateOn({ analysis, mode: item.mode, amount: item.amount, manualPrice: item.manualPrice, today })
    if (!r.ok) {
      skip(item.isin, r.reason, `${tk}: ${r.message}`)
      continue
    }
    settle = r.settle
    const flows = flowsOf(analysis)
    const rk = risk(r.pricePct, flows, r.settle)
    positions.push({
      isin: item.isin, ticker: tk, tickerO: row.tickerO, issuer: row.issuer, plaza: row.plaza, maturityDate: row.maturityDate,
      vn: r.vn, cost: r.cost, weightPct: 0, pricePct: r.pricePct, ytmPct: r.ytmPct, mdYears: rk?.modified ?? null,
      ytwKind: r.ytw?.kind ?? null, collected: r.totalCollected, priced: true, nextPayDate: null, nextPayAmount: null,
    })
    for (const p of r.payments) {
      payments.push({ isin: item.isin, ticker: tk, date: p.date, payDate: p.payDate, interest: p.interest, principal: p.principal, total: p.total })
    }

    // USD mode: rounding to whole VN always leaves < 1 VN of cash; more than that means the lot rules cut the purchase.
    const adjusted = item.mode === 'vn' ? Math.abs(r.vn - item.amount) > EPS : r.leftover > r.pricePct / 100 + EPS
    if (adjusted) warnings.push({ kind: 'lot-adjusted', isin: item.isin, message: `${tk}: se ajustó a ${fmtVn(r.vn)} por la lámina mínima y el múltiplo${item.mode === 'usd' ? ` (sobran ${usd(r.leftover)})` : ''}.` })
    const lost = r.payments.filter((p) => p.exCoupon)
    if (lost.length > 0) {
      const detail = lost.map((p) => `${usd(p.skippedInterest)} del ${fmtDate(p.date)}`).join(', ')
      warnings.push({ kind: 'record-window', isin: item.isin, message: `${tk}: comprás dentro de la fecha de registro y no cobrás el cupón (${detail}).` })
    }
    if (r.ytw?.kind === 'call') warnings.push({ kind: 'call', isin: item.isin, message: `${tk}: puede ser rescatada antes del vencimiento (el peor caso es el rescate del ${fmtDate(r.ytw.workoutDate)}); la TIR de la cartera asume que se cobra hasta el vencimiento.` })
    if (r.lineFallback && r.priceLine !== 'O') warnings.push({ kind: 'price-fallback', isin: item.isin, message: `${tk}: el precio es de otra línea que la de su plaza de pago; el canje no está incluido.` })
    if (r.noTrades) warnings.push({ kind: 'reference-price', isin: item.isin, message: `${tk}: el precio es de referencia, la línea no operó en la rueda.` })
  }

  return aggregate({ positions, payments, skipped, warnings, settle, today })
}

/** Combines per-ON positions and payments into the portfolio view. Shared by the test portfolios and the held (real) portfolio. */
export function aggregate({ positions, payments, skipped, warnings, settle, today }: {
  positions: Position[]; payments: PortfolioPayment[]; skipped: PortfolioAnalysis['skipped']; warnings: PortfolioWarning[]; settle: string; today: string
}): PortfolioAnalysis {
  if (positions.length === 0) return emptyAnalysis(settlementDate(today), skipped, warnings)

  const cost = positions.reduce((s, p) => s + p.cost, 0)
  const interest = payments.reduce((s, p) => s + p.interest, 0)
  const principal = payments.reduce((s, p) => s + p.principal, 0)
  const collected = interest + principal
  payments.sort((a, b) => (a.payDate === b.payDate ? (a.isin < b.isin ? -1 : 1) : a.payDate < b.payDate ? -1 : 1))
  const weighted = positions.map((p) => {
    const next = payments.find((x) => x.isin === p.isin)
    return { ...p, weightPct: cost > 0 ? (p.cost / cost) * 100 : 0, nextPayDate: next?.payDate ?? null, nextPayAmount: next?.total ?? null }
  })

  // Monthly calendar by ADJUSTED pay date, continuous from the first to the last payment month.
  const monthAcc = new Map<string, { interest: number; principal: number }>()
  for (const p of payments) {
    const k = p.payDate.slice(0, 7)
    const cur = monthAcc.get(k) ?? { interest: 0, principal: 0 }
    monthAcc.set(k, { interest: cur.interest + p.interest, principal: cur.principal + p.principal })
  }
  const monthly: MonthRow[] = []
  let running = 0
  for (let m = payments[0]?.payDate.slice(0, 7) ?? ''; payments.length > 0 && m <= payments[payments.length - 1].payDate.slice(0, 7); m = nextMonth(m)) {
    const a = monthAcc.get(m) ?? { interest: 0, principal: 0 }
    running += a.interest + a.principal
    monthly.push({ month: m, interest: a.interest, principal: a.principal, total: a.interest + a.principal, cumulative: running })
  }

  const yearAcc = new Map<number, { interest: number; principal: number }>()
  for (const p of payments) {
    const y = Number(p.payDate.slice(0, 4))
    const cur = yearAcc.get(y) ?? { interest: 0, principal: 0 }
    yearAcc.set(y, { interest: cur.interest + p.interest, principal: cur.principal + p.principal })
  }
  const years = [...yearAcc.keys()].sort((a, b) => a - b)
  const annual: YearRow[] = years.map((year) => {
    const a = yearAcc.get(year)!
    return { year, interest: a.interest, principal: a.principal, total: a.interest + a.principal }
  })
  const ladder: LadderRow[] = years
    .filter((y) => yearAcc.get(y)!.principal > EPS)
    .map((year) => ({ year, principal: yearAcc.get(year)!.principal, pct: principal > 0 ? (yearAcc.get(year)!.principal / principal) * 100 : 0 }))

  const horizon = plusOneYear(settle)
  const inYear = payments.filter((p) => p.payDate <= horizon)
  const next12mInterest = inYear.reduce((s, p) => s + p.interest, 0)
  const next12mPrincipal = inYear.reduce((s, p) => s + p.principal, 0)

  // Pooled yield: only ONs with a price and projected flows (a held floating or unpriced ON has no flows to match against its value).
  const yielding = new Set(weighted.filter((p) => p.priced && payments.some((x) => x.isin === p.isin)).map((p) => p.isin))
  const yieldBase = weighted.filter((p) => yielding.has(p.isin)).reduce((s, p) => s + p.cost, 0)
  const y = yieldBase > 0 ? ytm(100, pooled(payments.filter((p) => yielding.has(p.isin)), settle, yieldBase, (p) => p.total), settle) : null
  const mds = weighted.filter((p) => p.mdYears !== null)
  const mdCost = mds.reduce((s, p) => s + p.cost, 0)

  const issuerCost = new Map<string, number>()
  for (const p of weighted) {
    const name = p.issuer?.trim() || NO_ISSUER
    issuerCost.set(name, (issuerCost.get(name) ?? 0) + p.cost)
  }
  const issuers: IssuerRow[] = [...issuerCost.entries()].map(([name, c]) => ({ name, cost: c, pct: cost > 0 ? (c / cost) * 100 : 0 })).sort((a, b) => b.cost - a.cost)

  const plazaAcc = new Map<Plaza | null, { cost: number; collected: number }>()
  for (const p of weighted) {
    const cur = plazaAcc.get(p.plaza) ?? { cost: 0, collected: 0 }
    plazaAcc.set(p.plaza, { cost: cur.cost + p.cost, collected: cur.collected + p.collected })
  }
  const plazas: PlazaRow[] = [...plazaAcc.entries()].map(([plaza, a]) => ({ plaza, cost: a.cost, costPct: cost > 0 ? (a.cost / cost) * 100 : 0, collected: a.collected })).sort((a, b) => b.cost - a.cost)

  return {
    empty: false,
    settle,
    positions: weighted,
    skipped,
    totals: { cost, interest, principal, collected, profit: collected - cost },
    payments,
    monthly,
    annual,
    next12m: { interest: next12mInterest, principal: next12mPrincipal, total: next12mInterest + next12mPrincipal },
    ladder,
    ytmPct: y === null ? null : y * 100,
    mdYears: mdCost > 0 ? mds.reduce((s, p) => s + p.mdYears! * p.cost, 0) / mdCost : null,
    walYears: wal(pooled(payments, settle, 1, (p) => p.principal), settle),
    issuers,
    plazas,
    warnings,
  }
}
