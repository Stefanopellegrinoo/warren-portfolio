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

/** Nominal amount: lots and issued amounts are in VN (valor nominal), not in a currency. */
export const fmtVn = (x: number | null | undefined): string => (ok(x) ? `VN ${fmtNum(x, 0)}` : DASH)

/** Which line a price comes from; O is the implied cable price (O ÷ CCL). */
export function lineLabel(line: 'D' | 'C' | 'O' | null, ccl?: { rate: number } | null): string {
  if (line === 'C') return 'línea C · cable'
  if (line === 'D') return 'línea D · MEP'
  if (line === 'O') return `implícito · línea O ÷ CCL${ccl ? ` ($${fmtNum(ccl.rate)})` : ''}`
  return ''
}

export const TAX_COPY = 'ONs de oferta pública: exentas de Ganancias para personas humanas, art. 36 Ley 23.576; consultá a tu contador. Warren no calcula impuestos.'

/**
 * Parses a number typed by an es-AR user; null when the format is not recognised.
 * Rules: comma is always the decimal separator; dots are thousands separators only when
 * they form exact groups of 3 digits ("10.000", "1.000.000", "10.000,50"). A single dot
 * NOT followed by exactly 3 digits is a decimal point ("10000.50", "1.5"). So "1.000" is
 * one thousand, never 1.0. A thousands group never leads with 0: "0.500" and "00.500" are 0.5. No sign, exponent, spaces or currency symbols.
 */
export function parseEsArNumber(text: string): number | null {
  const t = text.trim()
  const withComma = /^([1-9]\d{0,2}(?:\.\d{3})+|\d+),(\d+)$/.exec(t)
  if (withComma) return Number(`${withComma[1].replace(/\./g, '')}.${withComma[2]}`)
  if (/^\d+$/.test(t)) return Number(t)
  if (/^[1-9]\d{0,2}(?:\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''))
  if (/^\d+\.\d+$/.test(t)) return Number(t)
  return null
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
/** yyyy-mm to "abr 2027" by string slicing. */
export function fmtMonth(ym: string | null | undefined): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(ym ?? '')
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : DASH
}
