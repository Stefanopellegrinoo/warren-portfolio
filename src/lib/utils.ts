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
