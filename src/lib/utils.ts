import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatUSD(value: number, compact = false): string {
  if (compact && Math.abs(value) >= 1000) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD',
      notation: 'compact', maximumFractionDigits: 1,
    }).format(value)
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value)
}

/** Formats a FRACTION (0.1234 -> "+12.34%"). Percent-valued inputs must be divided by 100 first. */
export function formatPct(
  value: number | null | undefined,
  { digits = 2, sign = true }: { digits?: number; sign?: boolean } = {},
): string {
  if (value == null || !isFinite(value)) return '—'
  const pct = value * 100
  return `${sign && pct >= 0 ? '+' : ''}${pct.toFixed(digits)}%`
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
/** Covers a weekend plus a Monday holiday; Quote.updatedAt is FETCH time, so closed markets keep refreshing. */
export const PRICE_STALE_CLOSED_MS = 96 * 3_600_000

/**
 * True when a price's as-of instant is missing/unparseable or older than the
 * threshold for the current market state. Future as-of values count as fresh.
 * ponytail: no holiday calendar; a 4-day AR holiday flags on the evening of day 4.
 */
export function isPriceStale(asOf: string | undefined, now: Date = new Date()): boolean {
  const t = asOf ? Date.parse(asOf) : NaN
  if (Number.isNaN(t)) return true
  const limit = isMarketOpen(now) ? PRICE_STALE_OPEN_MS : PRICE_STALE_CLOSED_MS
  return now.getTime() - t > limit
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
