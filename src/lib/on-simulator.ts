// Single-ON payment simulator (pure: no DB, no network). Works on the same analysis the
// detail page already holds: the schedule, the resolved terms and the live dirty price.
// Prices are DIRTY per 100 ORIGINAL VN; quantity = VN/100; interest goes to the record-date
// holder; amortization reduces the residual, not the VN held. No taxes, fees or reinvestment.
import { addDays, arCalendar, settlementDate } from './ar-calendar'
import type { Flow } from './bond-math'
import { yieldToWorst } from './bond-options'
import { accrued, isExCoupon, risk, ytm } from './bond-yield'
import { fmtVn } from './on-format'
import type { OnAnalysis } from './on-analytics'
import type { Plaza } from './on-terms'

export interface SimParams {
  analysis: OnAnalysis
  mode: 'usd' | 'vn' // what `amount` is
  amount: number
  manualPrice?: number | null // dirty, per 100 VN; replaces the market price
  today: string // ISO date of the purchase; settlement is T+1 business day
}

export interface SimPayment {
  date: string // contractual (unadjusted)
  payDate: string // business-day adjusted
  interest: number // USD
  principal: number
  total: number
  cumulative: number
  exCoupon: boolean // bought after the record date: the coupon goes to the seller
  skippedInterest: number // the coupon the buyer does not get (0 unless exCoupon)
}

export type SimRefusal = 'floating' | 'not-usd' | 'bad-amount' | 'bad-price' | 'no-price' | 'below-min' | 'no-payments'

export type SimResult =
  | { ok: false; reason: SimRefusal; message: string }
  | {
      ok: true
      settle: string
      vn: number
      quantity: number
      pricePct: number
      priceSource: 'D' | 'C' | 'O' | 'manual'
      priceLine: 'D' | 'C' | 'O' | null
      lineFallback: boolean
      noTrades: boolean
      plaza: Plaza | null
      lot: { known: boolean; minVn: number; incrementVn: number }
      cost: number
      leftover: number // USD input not invested (USD mode)
      accruedPct: number // per 100 VN, negative inside the record window
      accruedUsd: number
      payments: SimPayment[]
      totalInterest: number
      totalPrincipal: number
      totalCollected: number
      profit: number
      paybackDate: string | null
      ytmPct: number | null
      ytw: { ytwPct: number; workoutDate: string; kind: 'maturity' | 'call' } | null
      notes: string[]
    }

/** The live schedule as bond-math flows (record date applied); shared by the simulator and the portfolio analytics. */
export function flowsOf({ detail }: OnAnalysis): Flow[] {
  const offset = detail.terms.recordOffsetDays.value ?? 0
  return detail.schedule.map((s) => ({
    date: s.date,
    payDate: s.payDate,
    recordDate: addDays(s.date, -offset),
    couponPct: s.couponPct ?? 0,
    amortPct: s.amortPct,
    residualBeforePct: s.residualBeforePct,
    couponSource: 'byma',
  }))
}

const refuse = (reason: SimRefusal, message: string): SimResult => ({ ok: false, reason, message })
const EPS = 1e-9
const MAX_SIM = 1e12 // sanity cap on VN and cost

export function simulateOn({ analysis, mode, amount, manualPrice, today }: SimParams): SimResult {
  const { row, detail } = analysis
  const t = detail.terms
  if (row.rateType === 'floating') return refuse('floating', 'No simulable: tasa variable')
  if (row.currency !== 'USD') return refuse('not-usd', 'No simulable: la ON no está en dólares')
  if (!(amount > 0) || !Number.isFinite(amount)) return refuse('bad-amount', 'Ingresá un monto mayor a cero')

  // A manual price that was typed but is not usable must never fall back to the market price.
  if (manualPrice != null && !(manualPrice > 0 && Number.isFinite(manualPrice))) return refuse('bad-price', 'Precio manual inválido: ingresá un número mayor a cero')
  const manual = manualPrice != null
  const pricePct = manual ? manualPrice! : row.price
  if (pricePct === null || !(pricePct > 0)) return refuse('no-price', 'Sin precio: ingresá un precio manual para simular')

  // Lot rules come only from curated overrides; unknown means 1 VN and we say so.
  const minDen = t.minDenomination.value
  const minUnit = t.minTradeUnit.value
  const step = t.increment.value
  const known = minDen !== null || minUnit !== null || step !== null
  const minKnown = Math.max(minDen ?? 0, minUnit ?? 0)
  // Increment known but no minimum: the multiple is assumed as the minimum (stated in the notes).
  const minVn = minKnown || step || 1
  const incrementVn = step ?? 1
  const raw = mode === 'vn' ? amount : amount / (pricePct / 100)
  if (!Number.isFinite(raw) || raw > MAX_SIM) return refuse('bad-amount', 'Monto demasiado grande')
  if (raw < minVn - EPS) return refuse('below-min', `Mínimo: ${fmtVn(minVn)}`)
  const vn = minVn + Math.floor((raw - minVn) / incrementVn + EPS) * incrementVn

  const cost = (vn * pricePct) / 100
  if (!Number.isFinite(vn) || !Number.isFinite(cost) || vn > MAX_SIM || cost > MAX_SIM) return refuse('bad-amount', 'Monto demasiado grande')

  const notes: string[] = []
  if (!known) notes.push('Con la lámina mínima desconocida se permite desde VN 1.')
  else if (minKnown === 0) notes.push(`Con la lámina mínima desconocida se asume el múltiplo (${fmtVn(step)}) como mínimo.`)
  if (known && step === null) notes.push('Múltiplo de negociación desconocido: se asume VN 1.')
  if (known ? Math.abs(vn - raw) > EPS && (mode === 'vn' || incrementVn > 1) : mode === 'vn' && vn !== raw) {
    notes.push(`Se redondeó hacia abajo a ${fmtVn(vn)} para respetar la lámina mínima y el múltiplo.`)
  }

  const settle = settlementDate(today)
  const flows = flowsOf(analysis)

  let cumulative = 0
  const payments: SimPayment[] = []
  flows.forEach((f, i) => {
    if (f.date <= settle) return
    const ex = isExCoupon(flows, i, settle)
    const interest = ex ? 0 : (vn * f.couponPct) / 100
    const principal = (vn * f.amortPct) / 100
    cumulative += interest + principal
    payments.push({ date: f.date, payDate: f.payDate, interest, principal, total: interest + principal, cumulative, exCoupon: ex, skippedInterest: ex ? (vn * f.couponPct) / 100 : 0 })
  })
  if (payments.length === 0) return refuse('no-payments', 'La ON no tiene pagos posteriores a la liquidación')
  if (payments.some((p) => p.exCoupon)) {
    notes.push('Comprás dentro de la fecha de registro: no cobrás el cupón que se paga en esa fecha (lo cobra quien vendió); la amortización sí.')
  }

  const totalInterest = payments.reduce((s, p) => s + p.interest, 0)
  const totalPrincipal = payments.reduce((s, p) => s + p.principal, 0)
  const totalCollected = totalInterest + totalPrincipal
  const accruedPct = accrued(flows, settle, t.dayCount.value, detail.accrualStart)
  const worst = t.calls.value.length === 0
    ? null
    : yieldToWorst(pricePct, flows, t.calls.value, settle, t.dayCount.value, detail.accrualStart, { bdc: t.bdc.value, cal: arCalendar })
  const y = ytm(pricePct, flows, settle)

  return {
    ok: true,
    settle,
    vn,
    quantity: vn / 100,
    pricePct,
    priceSource: manual ? 'manual' : row.priceLine ?? 'D',
    priceLine: manual ? null : row.priceLine,
    lineFallback: !manual && row.lineFallback,
    noTrades: !manual && row.priceQuality === 'no-trades',
    plaza: row.plaza,
    lot: { known, minVn, incrementVn },
    cost,
    leftover: mode === 'usd' ? amount - cost : 0,
    accruedPct,
    accruedUsd: (vn * accruedPct) / 100,
    payments,
    totalInterest,
    totalPrincipal,
    totalCollected,
    profit: totalCollected - cost,
    paybackDate: payments.find((p) => p.cumulative >= cost - EPS)?.payDate ?? null,
    ytmPct: y === null ? null : y * 100,
    ytw: worst ? { ytwPct: worst.ytw * 100, workoutDate: worst.workoutDate, kind: worst.kind } : null,
    notes,
  }
}

export interface HeldPayment {
  date: string
  payDate: string
  interest: number
  principal: number
  total: number
  recordPassed: boolean // a buyer today would not get this coupon (record date behind us, same rule as the yield); the holder still collects it
}

export type HeldResult =
  | { ok: false; reason: 'not-usd' | 'no-payments'; message: string }
  | {
      ok: true
      settle: string
      floating: boolean // listed and valued, but its payments are not projected
      pricePct: number | null
      marketValue: number | null
      payments: HeldPayment[]
      ytmPct: number | null
      mdYears: number | null
      priceLine: 'D' | 'C' | 'O' | null
      lineFallback: boolean
      noTrades: boolean
    }

/**
 * What a CURRENT holder collects. `vn` is the exact nominal held (ledger quantity x 100, original VN): no lot rounding,
 * no purchase cost. A payment counts while its adjusted pay date is still ahead, even if the record date has passed
 * (the buyer-side ex-coupon rule does not apply to someone who already holds). The price only feeds market value and yield.
 */
export function simulateHeld({ analysis, vn, today }: { analysis: OnAnalysis; vn: number; today: string }): HeldResult {
  const { row } = analysis
  if (row.currency !== 'USD') return { ok: false, reason: 'not-usd', message: 'No proyectable: la ON no está en dólares' }
  const settle = settlementDate(today)
  const flows = flowsOf(analysis)
  const floating = row.rateType === 'floating'
  // A payment due TODAY is not projected: it is treated as already credited.
  const live = flows.map((f, i) => ({ f, i })).filter(({ f }) => f.payDate > today)
  if (live.length === 0) return { ok: false, reason: 'no-payments', message: 'La ON está vencida: ya no tiene pagos futuros' }

  const pricePct = row.price !== null && row.price > 0 ? row.price : null
  const payments: HeldPayment[] = floating ? [] : live.map(({ f, i }) => {
    const interest = (vn * f.couponPct) / 100
    const principal = (vn * f.amortPct) / 100
    return { date: f.date, payDate: f.payDate, interest, principal, total: interest + principal, recordPassed: interest > 0 && isExCoupon(flows, i, settle) }
  })
  const priced = pricePct !== null && !floating
  const y = priced ? ytm(pricePct, flows, settle) : null
  const rk = priced ? risk(pricePct, flows, settle) : null
  return {
    ok: true, settle, floating, pricePct,
    marketValue: pricePct === null ? null : (vn * pricePct) / 100,
    payments, ytmPct: y === null ? null : y * 100, mdYears: rk?.modified ?? null,
    priceLine: row.priceLine, lineFallback: row.lineFallback, noTrades: row.priceQuality === 'no-trades',
  }
}
