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

export function formatPct(value: number): string {
  const pct = value * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
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

export function isMarketOpen(): boolean {
  const d = new Date()

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
