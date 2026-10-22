import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const MINUS = '\u2212'

// Intl may emit non-breaking spaces; normalize so output is predictable.
const plainSpaces = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ')

/** es-AR number: 39.951,80. Negatives always use U+2212; `sign` adds "+" to positives. */
export function formatNumber(value: number, { decimals = 2, sign = false }: { decimals?: number; sign?: boolean } = {}): string {
  const body = plainSpaces(new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(Math.abs(value)))
  const isZero = Number(body.replace(/\./g, '').replace(',', '.')) === 0
  if (isZero) return body
  if (value < 0) return MINUS + body
  return sign ? '+' + body : body
}

export function formatUSD(value: number, compact = false): string {
  const body = compact && Math.abs(value) >= 1000
    ? plainSpaces(new Intl.NumberFormat('es-AR', { notation: 'compact', maximumFractionDigits: 1 }).format(Math.abs(value)))
    : formatNumber(Math.abs(value))
  // Non-breaking space: the currency must never wrap away from its amount.
  return (formatNumber(value).startsWith(MINUS) ? MINUS : '') + 'US$\u00a0' + body
}

/** Formats a FRACTION (0.1234 -> "+12,34 %"). Percent-valued inputs must be divided by 100 first. */
export function formatPct(
  value: number | null | undefined,
  { digits = 2, sign = true }: { digits?: number; sign?: boolean } = {},
): string {
  if (value == null || !isFinite(value)) return '—'
  return `${formatNumber(value * 100, { decimals: digits, sign })} %`
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function pnlColor(value: number): string {
  if (value > 0) return 'text-emerald'
  if (value < 0) return 'text-rose'
  return 'text-slate-400'
}

export function pnlBg(value: number): string {
  if (value > 0) return 'bg-emerald/10 text-emerald border-emerald/20'
  if (value < 0) return 'bg-rose/10 text-rose border-rose/20'
  return 'bg-slate-500/10 text-slate-400 border-slate-500/20'
}

export function isMarketOpen(now: Date = new Date()): boolean {
  const d = now

  // Create a new date object for Argentina time (UTC-3)
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000)
  const nd = new Date(utc + (3600000 * -3))

  const day = nd.getDay()
  // 0 = Sunday, 6 = Saturday
  if (day === 0 || day === 6) return false

  const hour = nd.getHours()
  const minute = nd.getMinutes()
  const time = hour + minute / 60

  // 10:30 to 18:00 AR time covers US and AR markets broadly
  if (time >= 10.5 && time < 18) {
    return true
  }

  return false
}

/** 6 missed 5-minute refresh cycles while the market is open. */
export const PRICE_STALE_OPEN_MS = 30 * 60_000
/**
 * After the open, the first refresh cycle needs a moment: a price from the
 * previous session is not flagged until open + this grace (3 missed cycles).
 */
export const PRICE_STALE_OPEN_GRACE_MS = 15 * 60_000
/**
 * Covers a weekend plus a Monday holiday. Quote.updatedAt is FETCH time and the
 * price worker skips repeat fetches while the market is closed, so the last
 * fetch is from the previous session's close.
 */
export const PRICE_STALE_CLOSED_MS = 96 * 3_600_000

/**
 * True when a price's as-of instant is missing/unparseable or older than the
 * threshold for the current market state. Future as-of values count as fresh.
 * ponytail: no holiday calendar; a 4-day AR holiday flags on the evening of day 4.
 */
export function isPriceStale(asOf: string | undefined, now: Date = new Date()): boolean {
  const t = asOf ? Date.parse(asOf) : NaN
  if (Number.isNaN(t)) return true
  const age = now.getTime() - t
  if (age > PRICE_STALE_CLOSED_MS) return true
  if (!isMarketOpen(now)) return false
  if (age <= PRICE_STALE_OPEN_MS) return false
  // Previous-session price right after the open: give the first refresh time.
  return t >= marketOpenInstant(now) || msSinceOpen(now) > PRICE_STALE_OPEN_GRACE_MS
}

const OPEN_MINUTES = 10 * 60 + 30 // 10:30 AR, see isMarketOpen

/** Milliseconds since 10:30 AR on `now`'s Argentine day (call only while open). */
function msSinceOpen(now: Date): number {
  const ar = new Date(now.getTime() - 3 * 3_600_000) // read with getUTC*: AR is UTC-3, no DST
  const ms = ((ar.getUTCHours() * 60 + ar.getUTCMinutes() - OPEN_MINUTES) * 60 + ar.getUTCSeconds()) * 1000 + ar.getUTCMilliseconds()
  return ms
}

const marketOpenInstant = (now: Date) => now.getTime() - msSinceOpen(now)

/** "hace 5 min" / "hace 2 h" / "hace 3 d"; "sin dato" when there is no usable as-of. */
export function formatAge(asOf: string | undefined, now: Date = new Date()): string {
  const t = asOf ? Date.parse(asOf) : NaN
  if (Number.isNaN(t)) return 'sin dato'
  const min = Math.max(0, Math.floor((now.getTime() - t) / 60_000))
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  return h < 48 ? `hace ${h} h` : `hace ${Math.floor(h / 24)} d`
}

/** Priced positions (current_price set) whose price is stale. Unpriced ones are counted elsewhere. */
export function countStalePrices(
  items: { current_price?: number; price_as_of?: string }[],
  now: Date = new Date(),
): number {
  return items.filter(i => i.current_price && isPriceStale(i.price_as_of, now)).length
}

/** Header suffix: "1 desactualizado · 2 sin precio". Empty when nothing is wrong. */
export function priceHealthSummary(
  items: { current_price?: number; price_as_of?: string }[],
  now: Date = new Date(),
): string {
  const stale = countStalePrices(items, now)
  const unpriced = items.filter(i => !i.current_price).length
  const parts: string[] = []
  if (stale > 0) parts.push(`${stale} desactualizado${stale === 1 ? '' : 's'}`)
  if (unpriced > 0) parts.push(`${unpriced} sin precio`)
  return parts.join(' · ')
}

/** IANA zone for the market and the user this app serves. */
export const PORTFOLIO_TIMEZONE = 'America/Argentina/Buenos_Aires'

/**
 * The calendar date in Argentina for a given instant, as YYYY-MM-DD.
 *
 * Snapshots must be stamped with the LOCAL day, not the UTC one. The daily job
 * runs at 02:00 UTC so it captures the whole Argentine day, and at that hour
 * the UTC date is already tomorrow — stamping it would file the evening under
 * the wrong day and break the pairing with `cash_movements.date`, which is a
 * plain local date.
 *
 * 'en-CA' is used because it formats as YYYY-MM-DD.
 */
export function argentinaDate(when: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PORTFOLIO_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(when)
}
