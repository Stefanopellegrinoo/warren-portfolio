import type { PortfolioSummary } from '@/types'
import type { Currency, CurrencyViews } from '@/lib/multicurrency'

export const CURRENCIES: { id: Currency; label: string; prefix: string }[] = [
  { id: 'ARS', label: 'Pesos', prefix: '$' },
  { id: 'MEP', label: 'Dólar MEP', prefix: 'US$' },
  { id: 'CCL', label: 'Dólar cable', prefix: 'US$' },
]
export const DEFAULT_CURRENCY: Currency = 'MEP'
const STORAGE_KEY = 'resumen:currency'

const isCurrency = (v: unknown): v is Currency => CURRENCIES.some(c => c.id === v)

/** The viewer's last choice. Storage can be missing or blocked: then the default. */
export function readCurrency(): Currency {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return isCurrency(stored) ? stored : DEFAULT_CURRENCY
  } catch {
    return DEFAULT_CURRENCY
  }
}

export function saveCurrency(c: Currency): void {
  try { window.localStorage.setItem(STORAGE_KEY, c) } catch { /* a per-viewer convenience only */ }
}

/** The views of a /api/positions payload, only in a version this client knows. */
export function viewsOf(payload: { currencies?: unknown }): CurrencyViews | null {
  const v = payload.currencies as CurrencyViews | null | undefined
  return v && v.version === 1 ? v : null
}

export interface Headline {
  prefix: string
  total: number
  dayPnl: number
  dayPnlPct: number
  openPnl: number
  openPnlPct: number
  realized: number
  realizedLabel: string
  /** Cost of the open positions plus cash: "Costo + caja", not the money put in (statistics-truth S9). */
  capital: number
}

export function headline(summary: PortfolioSummary, views: CurrencyViews | null, currency: Currency): Headline {
  if (!views) {
    return {
      prefix: 'US$', total: summary.total_market_value, dayPnl: summary.day_pnl, dayPnlPct: summary.day_pnl_pct,
      openPnl: summary.open_pnl, openPnlPct: summary.open_pnl_pct, realized: summary.realized_pnl, realizedLabel: 'Resultado realizado',
      capital: summary.total_invested + summary.cash.balance,
    }
  }
  const t = views.totals
  return {
    prefix: CURRENCIES.find(c => c.id === currency)!.prefix,
    total: t.value[currency],
    // The day's move of each price at today's dollar: the dollar's own move is not in it.
    dayPnl: t.dayChange[currency],
    dayPnlPct: t.dayChangePct[currency],
    openPnl: t.openPnl[currency],
    openPnlPct: t.openPnlPct[currency],
    realized: t.realized[currency],
    realizedLabel: 'Realizado, con dividendos y cupones',
    capital: t.invested[currency] + t.cash[currency],
  }
}
