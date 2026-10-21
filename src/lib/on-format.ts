// Spanish (es-AR) display helpers for the ON pages. Pure.
import type { Plaza } from './on-terms'
import type { RateType } from './on-analytics'

const DASH = '—'
const ok = (x: number | null | undefined): x is number => typeof x === 'number' && Number.isFinite(x)

export function fmtNum(x: number | null | undefined, digits = 2): string {
  return ok(x) ? new Intl.NumberFormat('es-AR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(x) : DASH
}

export const fmtPct = (x: number | null | undefined, digits = 2): string => (ok(x) ? `${fmtNum(x, digits)}%` : DASH)

/** Basis points with an explicit sign for positives ("+121 pb"). */
export function fmtBp(x: number | null | undefined): string {
  if (!ok(x)) return DASH
  const r = Math.round(x)
  return `${r > 0 ? '+' : ''}${r} pb`
}

export function fmtUsdCompact(x: number | null | undefined): string {
  if (!ok(x)) return DASH
  if (Math.abs(x) < 1000) return `USD ${fmtNum(x, 0)}`
  // Intl puts a no-break space before the "M"; a plain space keeps copy and tests simple.
  return `USD ${new Intl.NumberFormat('es-AR', { notation: 'compact', maximumFractionDigits: 1 }).format(x)}`.replace(/\u00a0/g, ' ')
}

/** ISO yyyy-mm-dd to dd/mm/yyyy by string slicing, so no timezone can shift the day. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return DASH
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

export function plazaCopy(plaza: Plaza | null): string {
  if (plaza === 'MEP') return 'Paga en dólar MEP (cuenta local)'
  if (plaza === 'CCL') return 'Paga en dólar cable (exterior)'
  if (plaza === 'ARS') return 'Paga en pesos'
  return 'Plaza de pago: sin dato'
}

const RATE_LABELS: Record<RateType, string> = {
  fixed: 'Tasa fija',
  step: 'Step up',
  zero: 'Cupón cero',
  floating: 'Tasa variable',
  other: 'Otra',
}
export const rateTypeLabel = (t: RateType): string => RATE_LABELS[t]

const EVENT_LABELS: Record<string, string> = { canje: 'Canje', rescate: 'Rescate', default: 'Default', reapertura: 'Reapertura' }
export const eventLabel = (kind: string): string => EVENT_LABELS[kind] ?? kind

/** Source links come from curated data, but never render a non-http(s) href. */
export function safeHref(url: string | null | undefined): string | undefined {
  try {
    const u = new URL(url ?? '')
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : undefined
  } catch {
    return undefined
  }
}
