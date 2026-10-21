// Terms resolver (pure): per field, override > BYMA > default, with provenance.
// Overrides come from on_terms_overrides (curated, migration-only). A malformed
// override is ignored so the lower layer applies. Defaults are "sin verificar".
import { z } from 'zod'
import { defaultDayCount, type DayCount, type Bdc, type Prov } from './bond-math'
import type { CallWindow } from './bond-options'
import { isRealDate } from './byma-educa'

export type Plaza = 'MEP' | 'CCL' | 'ARS'

export interface F<T> {
  value: T
  prov: Prov
  sourceUrl?: string
  verifiedAt?: string | null
}

export interface OverrideRow {
  isin: string
  field: string
  value: unknown
  sourceUrl: string
  verifiedAt: string | null
}

export interface TermsBase {
  isin: string
  law: 'ARG' | 'NY'
  paymentPlaza: Plaza | null
  issuedAmountByma: number | null
}

export interface OverrideWarning {
  isin: string
  field: string
  reason: string
}

export interface Put {
  kind: string
  pricePct: number
  note?: string
}

const isoDate = z.string().refine(isRealDate, 'not a real ISO date')
const bdc = z.enum(['following', 'modified_following', 'preceding'])
const pos = z.number().positive().finite()
const call = z.object({ from: isoDate, to: isoDate.nullable(), pricePct: pos })
const put = z.object({ kind: z.string().min(1), pricePct: pos, note: z.string().optional() }).passthrough()

// Each window ends after it starts, and the next one starts at or after the previous end.
function validWindows(ws: { from: string; to: string | null }[]): boolean {
  return ws.every((w, i) => {
    if (w.to !== null && w.to <= w.from) return false
    const prev = ws[i - 1]
    return !prev || (prev.to !== null && w.from >= prev.to)
  })
}

const SCHEMAS = {
  day_count: z.enum(['30/360', 'ACT/365', 'ACT/360', 'ACT/ACT']),
  bdc,
  maturity_bdc: bdc,
  record_offset_days: z.number().int().min(0).max(60),
  payment_plaza: z.enum(['MEP', 'CCL', 'ARS']),
  min_denomination: pos,
  min_trade_unit: pos,
  increment: pos,
  issued_amount: pos,
  calls: z.array(call).refine(validWindows, 'call windows must have to > from and be ordered without overlap'),
  puts: z.array(put),
} as const

type Field = keyof typeof SCHEMAS

export interface ResolvedTerms {
  dayCount: F<DayCount>
  bdc: F<Bdc>
  maturityBdc: F<Bdc>
  recordOffsetDays: F<number | null>
  paymentPlaza: F<Plaza | null>
  minDenomination: F<number | null>
  minTradeUnit: F<number | null>
  increment: F<number | null>
  issuedAmount: F<number | null>
  issuedAmountByma: number | null // shown only as "según BYMA, puede estar desactualizado"
  calls: F<CallWindow[]>
  puts: F<Put[]>
  // Overrides that exist for this ISIN but were ignored (malformed or unknown field).
  warnings: OverrideWarning[]
}

export function resolveTerms(base: TermsBase, overrides: OverrideRow[]): ResolvedTerms {
  const mine = new Map(overrides.filter((o) => o.isin === base.isin).map((o) => [o.field, o]))
  const warnings: OverrideWarning[] = []
  for (const o of mine.values()) {
    if (!(o.field in SCHEMAS)) warnings.push({ isin: o.isin, field: o.field, reason: 'unknown field' })
    else {
      const p = SCHEMAS[o.field as Field].safeParse(o.value)
      if (!p.success) warnings.push({ isin: o.isin, field: o.field, reason: p.error.issues[0]?.message ?? 'invalid value' })
    }
  }
  // Layer 1: a valid override for this ISIN and field.
  const fromOverride = <K extends Field>(field: K): F<z.infer<(typeof SCHEMAS)[K]>> | null => {
    const o = mine.get(field)
    const p = o && SCHEMAS[field].safeParse(o.value)
    if (!o || !p || !p.success) return null
    return { value: p.data, prov: o.verifiedAt ? 'verified' : 'secondary', sourceUrl: o.sourceUrl, verifiedAt: o.verifiedAt } as F<z.infer<(typeof SCHEMAS)[K]>>
  }
  const pick = <K extends Field, D>(field: K, lower: F<D>): F<z.infer<(typeof SCHEMAS)[K]> | D> => fromOverride(field) ?? lower
  const dflt = <T>(value: T): F<T> => ({ value, prov: 'default' })

  const byma = <T>(v: T | null): F<T | null> => (v === null ? dflt(null) : { value: v, prov: 'byma' })
  return {
    dayCount: pick('day_count', dflt(defaultDayCount(base.law))),
    bdc: pick('bdc', dflt<Bdc>('following')),
    maturityBdc: pick('maturity_bdc', dflt<Bdc>('following')),
    recordOffsetDays: pick('record_offset_days', dflt<number | null>(null)),
    paymentPlaza: pick('payment_plaza', byma(base.paymentPlaza)),
    minDenomination: pick('min_denomination', dflt<number | null>(null)),
    minTradeUnit: pick('min_trade_unit', dflt<number | null>(null)),
    increment: pick('increment', dflt<number | null>(null)),
    issuedAmount: pick('issued_amount', byma(base.issuedAmountByma)),
    issuedAmountByma: base.issuedAmountByma,
    calls: pick('calls', dflt<CallWindow[]>([])),
    puts: pick('puts', dflt<Put[]>([])),
    warnings,
  }
}
