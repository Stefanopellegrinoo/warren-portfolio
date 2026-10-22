import type { Position, ONPosition, PortfolioSummary } from '@/types'
import { formatNumber, formatPct } from '@/lib/utils'
import { fmtVn } from '@/lib/on-format'
import type { Currency, CurrencyViews } from '@/lib/multicurrency'

export type HoldingKind = 'stock' | 'cedear' | 'on'

export interface HoldingRow {
  ticker: string
  name: string | null
  kind: HoldingKind
  quantityLabel: string
  weightPct: number
  /** Fractions, as the API sends them. null when the position has no price. */
  dayChangePct: number | null
  value: number | null
  pnl: number | null
  pnlPct: number | null
  href: string
  quantity: number
  price: number | null
  avgCost: number
  invested: number
  /** Valued with the estimated fallback (no peso price). */
  estimated?: boolean
}

export interface ReviewItem { ticker: string; name: string | null; tone: 'danger' | 'warn'; chip: string; why: string; href: string }

/** Accumulated loss that puts a position in "Para revisar". */
export const LOSS_THRESHOLD = -0.30
/** The day's biggest drop is flagged only past this. */
export const DAY_DROP_THRESHOLD = -0.03

const num = (x: number | undefined): number | null => (typeof x === 'number' && isFinite(x) ? x : null)

/** Shares are kept to 6 decimals, so a whole CEDEAR count comes back as 1099.99999... */
const wholeIfClose = (x: number) => (Math.abs(x - Math.round(x)) < 0.01 ? Math.round(x) : x)

function quantityLabel(kind: HoldingKind, count: number): string {
  // Ledger stores ONs as VN / 100.
  if (kind === 'on') return fmtVn(count * 100)
  const n = formatNumber(count, { decimals: Number.isInteger(count) ? 0 : 2 })
  if (kind === 'cedear') return `${n} ${count === 1 ? 'CEDEAR' : 'CEDEARs'}`
  return `${n} ${count === 1 ? 'acción' : 'acciones'}`
}

function toRow(p: Position | ONPosition, kind: HoldingKind, names: Record<string, string>, total: number, inCurrency: InCurrency | null, ratio?: number): HoldingRow {
  const v = inCurrency?.views.positions[p.ticker]
  const c = inCurrency?.currency
  // One currency view, or the USD engine fields as they come.
  const f = v && c
    ? { value: v.value?.[c] ?? null, pnl: v.pnl?.[c] ?? null, pnlPct: v.pnlPct?.[c] ?? null, price: v.price?.[c] ?? null,
        dayChangePct: v.dayChangePct, avgCost: v.avgCost[c], invested: v.cost[c], estimated: v.estimated }
    : { value: num(p.market_value), pnl: num(p.pnl), pnlPct: num(p.pnl_pct), price: num(p.current_price),
        dayChangePct: num(p.day_change_pct), avgCost: p.avg_cost, invested: p.total_invested, estimated: false }
  const value = f.value
  // CEDEAR rows read per CEDEAR, as the broker shows them: shares × ratio, price and cost ÷ ratio.
  const k = kind === 'cedear' && ratio ? ratio : 1
  const quantity = kind === 'cedear' && ratio ? wholeIfClose(p.quantity * k) : p.quantity
  return {
    ticker: p.ticker,
    name: kind === 'on' ? null : names[p.ticker] ?? null,
    kind,
    quantityLabel: quantityLabel(kind, quantity),
    weightPct: value !== null && total > 0 ? (value / total) * 100 : 0,
    dayChangePct: value === null ? null : f.dayChangePct,
    value,
    pnl: value === null ? null : f.pnl,
    pnlPct: value === null ? null : f.pnlPct,
    href: kind === 'on' ? '/ons/mi-cartera' : `/trading?symbol=${encodeURIComponent(p.ticker)}`,
    quantity,
    price: value === null || f.price === null ? null : f.price / k,
    avgCost: f.avgCost / k,
    invested: f.invested,
    estimated: f.estimated,
  }
}

type InCurrency = { views: CurrencyViews; currency: Currency }

export function buildHoldings(input: {
  positions: Position[]
  onPositions: ONPosition[]
  cedearTickers: string[]
  /** CEDEARs per underlying share, to show the count as the broker does. */
  cedearRatios?: Record<string, number>
  names: Record<string, string>
  /** The portfolio total in the same unit as the rows, for the weights. */
  total: number
  views?: CurrencyViews | null
  currency?: Currency
}): HoldingRow[] {
  const cedears = new Set(input.cedearTickers)
  const inCurrency = input.views && input.currency ? { views: input.views, currency: input.currency } : null
  const rows = [
    ...input.positions.map(p => toRow(p, cedears.has(p.ticker) ? 'cedear' : 'stock', input.names, input.total, inCurrency, input.cedearRatios?.[p.ticker])),
    ...input.onPositions.map(p => toRow(p, 'on', input.names, input.total, inCurrency)),
  ]
  return rows.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity))
}

export function reviewItems(rows: HoldingRow[]): ReviewItem[] {
  const losses = rows
    .filter(r => r.pnlPct !== null && r.pnlPct <= LOSS_THRESHOLD)
    .sort((a, b) => a.pnlPct! - b.pnlPct!)
    .map((r): ReviewItem => ({
      ticker: r.ticker,
      name: r.name,
      tone: 'danger',
      chip: formatPct(r.pnlPct, { digits: 1 }),
      why: `Pierde ${formatNumber(Math.abs(r.pnl ?? 0), { decimals: 0 })} desde la compra`,
      href: r.href,
    }))

  const listed = new Set(losses.map(l => l.ticker))
  const worstDay = rows
    .filter(r => r.dayChangePct !== null && r.dayChangePct <= DAY_DROP_THRESHOLD)
    .sort((a, b) => a.dayChangePct! - b.dayChangePct!)[0]

  if (!worstDay || listed.has(worstDay.ticker)) return losses
  return [...losses, {
    ticker: worstDay.ticker,
    name: worstDay.name,
    tone: 'warn',
    chip: `${formatPct(worstDay.dayChangePct, { digits: 1 })} hoy`,
    why: 'La mayor caída del día en tu cartera',
    href: worstDay.href,
  }]
}

export function distribution(
  summary: PortfolioSummary,
  views?: CurrencyViews | null,
  currency?: Currency,
): { label: string; pct: number; value: number }[] {
  const t = views && currency
    ? { total: views.totals.value[currency], stocks: views.totals.stocks[currency], cash: views.totals.cash[currency], ons: views.totals.ons[currency] }
    : { total: summary.total_market_value, stocks: summary.stocks.market_value, cash: summary.cash.balance, ons: summary.ons.market_value }
  const pct = (v: number) => (t.total > 0 ? (v / t.total) * 100 : 0)
  return [
    { label: 'Acciones y CEDEARs', value: t.stocks },
    { label: 'Caja', value: t.cash },
    { label: 'Obligaciones negociables', value: t.ons },
  ].map(d => ({ label: d.label, pct: pct(d.value), value: d.value }))
}
