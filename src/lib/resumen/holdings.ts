import type { Position, ONPosition, PortfolioSummary } from '@/types'
import { formatNumber } from '@/lib/utils'
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

export type SortKey = 'ticker' | 'quantity' | 'price' | 'avgCost' | 'invested' | 'value' | 'dayChangePct' | 'pnl' | 'pnlPct' | 'weightPct'
export interface Sort { key: SortKey; dir: 'asc' | 'desc' }
export const DEFAULT_SORT: Sort = { key: 'value', dir: 'desc' }

/** Rows without the figure (no price yet) go last whichever way you sort. */
export function sortRows(rows: HoldingRow[], sort: Sort): HoldingRow[] {
  return [...rows].sort((a, b) => {
    const av = a[sort.key], bv = b[sort.key]
    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1
    const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
    return sort.dir === 'asc' ? cmp : -cmp
  })
}

/** Same column flips the direction; a new one starts A→Z for names, biggest first for figures. */
export function nextSort(sort: Sort, key: SortKey): Sort {
  if (sort.key === key) return { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: key === 'ticker' ? 'asc' : 'desc' }
}

const GROUPS: { kind: HoldingKind; title: string }[] = [
  { kind: 'stock', title: 'Acciones' },
  { kind: 'cedear', title: 'CEDEARs' },
  { kind: 'on', title: 'Obligaciones negociables' },
]

/** One group per asset type, in a fixed order, keeping the rows' order inside each. */
export function groupRows(rows: HoldingRow[]): { kind: HoldingKind; title: string; items: HoldingRow[] }[] {
  return GROUPS.map(g => ({ ...g, items: rows.filter(r => r.kind === g.kind) }))
}

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

export function distribution(
  summary: PortfolioSummary,
  views?: CurrencyViews | null,
  currency?: Currency,
  /** The holdings in the same currency; the summary only knows stocks and CEDEARs together. */
  rows: HoldingRow[] = [],
): { label: string; pct: number; value: number }[] {
  const t = views && currency
    ? { total: views.totals.value[currency], stocks: views.totals.stocks[currency], cash: views.totals.cash[currency], ons: views.totals.ons[currency] }
    : { total: summary.total_market_value, stocks: summary.stocks.market_value, cash: summary.cash.balance, ons: summary.ons.market_value }
  const cedears = rows.reduce((s, r) => s + (r.kind === 'cedear' ? r.value ?? 0 : 0), 0)
  const pct = (v: number) => (t.total > 0 ? (v / t.total) * 100 : 0)
  return [
    { label: 'Acciones', value: t.stocks - cedears },
    { label: 'CEDEARs', value: cedears },
    { label: 'Obligaciones negociables', value: t.ons },
    { label: 'Caja', value: t.cash },
  ].map(d => ({ label: d.label, pct: pct(d.value), value: d.value }))
}
