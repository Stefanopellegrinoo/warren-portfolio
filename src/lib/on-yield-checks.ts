// Daily yield checks per ON (pure). Produces on_yield_checks rows.
//  - METHOD check: our solver on BYMA's own flows (ren + amo, UNADJUSTED dates, BYMA
//    settlement) vs BYMA ytm. The only check that is flagged (|diff| > FLAG_BP).
//  - TERMS check: our resolved flows (overrides / per-law defaults, computed coupons,
//    adjusted dates) at BYMA px. Informational: never flagged, never alerts.
// Under MIN_DAYS_TO_MATURITY the yield is hypersensitive to price, so those ONs are
// recorded with a skip reason instead of a number. Floating-rate ONs get no row.
import { actualDays, buildFlows, type RawFlow, type Flow } from './bond-math'
import { ytm } from './bond-yield'
import { resolveTerms, type OverrideRow } from './on-terms'
import type { OnRow } from './byma-educa'

export const FLAG_BP = 5
export const MIN_DAYS_TO_MATURITY = 90

export interface YieldCheck {
  isin: string
  as_of: string
  byma_px: number | null
  byma_ytm: number | null
  method_ytm: number | null
  method_diff_bp: number | null // ours minus BYMA, signed
  terms_ytm: number | null
  terms_diff_bp: number | null
  flagged: boolean
  skip_reason: string | null
}

// BYMA discounts on the unadjusted dates (adjusting moves ARG-law bonds by 1-2bp).
const unadjusted = { isBusinessDay: () => true, adjust: (d: string) => d }

const r2 = (x: number) => Math.round(x * 100) / 100
const r4 = (x: number) => Math.round(x * 10000) / 10000

function toRaw(o: OnRow): RawFlow[] {
  return o.flows.map((f) => ({ date: f.date, ren: f.ren, amo: f.amo }))
}

function pctYield(px: number, flows: Flow[], settle: string): number | null {
  const y = ytm(px, flows, settle)
  return y === null || !Number.isFinite(y) ? null : y * 100
}

function checkOne(o: OnRow, overrides: OverrideRow[], settle: string, asOf: string): YieldCheck {
  const base: YieldCheck = {
    isin: o.isin,
    as_of: asOf,
    byma_px: o.bymaPx,
    byma_ytm: o.bymaYtm,
    method_ytm: null,
    method_diff_bp: null,
    terms_ytm: null,
    terms_diff_bp: null,
    flagged: false,
    skip_reason: null,
  }
  const skip = (reason: string): YieldCheck => ({ ...base, skip_reason: reason })

  if (o.bymaPx === null || !(o.bymaPx > 0)) return skip('no price')
  if (o.bymaYtm === null) return skip('no BYMA ytm')
  if (actualDays(settle, o.maturityDate) < MIN_DAYS_TO_MATURITY) return skip(`under ${MIN_DAYS_TO_MATURITY} days to maturity`)

  try {
    const methodFlows = buildFlows(
      { issueDate: o.issueDate, rateType: 'byma', couponPct: 0, dayCount: '30/360', bdc: 'following', maturityBdc: 'following', recordOffsetDays: null },
      toRaw(o),
      unadjusted
    )
    const m = pctYield(o.bymaPx, methodFlows, settle)
    if (m === null) return skip('method yield did not converge')
    const methodDiff = (m - o.bymaYtm) * 100

    let termsYtm: number | null = null
    if (o.est === 'Tasa Fija' && o.couponRate !== null && o.couponRate > 0) {
      const t = resolveTerms({ isin: o.isin, law: o.law, paymentPlaza: o.paymentPlaza, issuedAmountByma: o.issuedAmountByma }, overrides)
      const flows = buildFlows(
        {
          issueDate: o.issueDate,
          accrualStart: o.accrualStart,
          residualPct: o.residualPct,
          rateType: 'fixed',
          couponPct: o.couponRate * 100,
          dayCount: t.dayCount.value,
          bdc: t.bdc.value,
          maturityBdc: t.maturityBdc.value,
          recordOffsetDays: t.recordOffsetDays.value,
        },
        toRaw(o)
      )
      termsYtm = pctYield(o.bymaPx, flows, settle)
    }
    return {
      ...base,
      method_ytm: r4(m),
      method_diff_bp: r2(methodDiff),
      terms_ytm: termsYtm === null ? null : r4(termsYtm),
      terms_diff_bp: termsYtm === null ? null : r2((termsYtm - o.bymaYtm) * 100),
      flagged: Math.abs(methodDiff) > FLAG_BP,
    }
  } catch (e) {
    return skip(`error: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}`)
  }
}

export function computeYieldChecks(ons: OnRow[], overrides: OverrideRow[], settle: string, asOf: string): YieldCheck[] {
  return ons.filter((o) => o.est !== 'Tasa Variable').map((o) => checkOne(o, overrides, settle, asOf))
}
