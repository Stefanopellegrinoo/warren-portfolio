import type { Position, ONPosition, PortfolioSummary } from '@/types'
import { formatNumber, formatPct } from '@/lib/utils'
import { fmtVn } from '@/lib/on-format'

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
}

export interface ReviewItem { ticker: string; name: string | null; tone: 'danger' | 'warn'; chip: string; why: string; href: string }

/** Accumulated loss that puts a position in "Para revisar". */
export const LOSS_THRESHOLD = -0.30
/** The day's biggest drop is flagged only past this. */
export const DAY_DROP_THRESHOLD = -0.03

const num = (x: number | undefined): number | null => (typeof x === 'number' && isFinite(x) ? x : null)

function quantityLabel(kind: HoldingKind, quantity: number): string {
  // Ledger stores ONs as VN / 100.
  if (kind === 'on') return fmtVn(quantity * 100)
  const n = formatNumber(quantity, { decimals: Number.isInteger(quantity) ? 0 : 2 })
  if (kind === 'cedear') return `${n} ${quantity === 1 ? 'CEDEAR' : 'CEDEARs'}`
  return `${n} ${quantity === 1 ? 'acción' : 'acciones'}`
}

function toRow(p: Position | ONPosition, kind: HoldingKind, names: Record<string, string>, total: number): HoldingRow {
  const value = num(p.market_value)
  return {
    ticker: p.ticker,
    name: kind === 'on' ? null : names[p.ticker] ?? null,
    kind,
    quantityLabel: quantityLabel(kind, p.quantity),
    weightPct: value !== null && total > 0 ? (value / total) * 100 : 0,
    dayChangePct: value === null ? null : num(p.day_change_pct),
    value,
    pnl: value === null ? null : num(p.pnl),
    pnlPct: value === null ? null : num(p.pnl_pct),
    href: kind === 'on' ? '/ons/mi-cartera' : `/trading?symbol=${encodeURIComponent(p.ticker)}`,
    quantity: p.quantity,
    price: value === null ? null : num(p.current_price),
    avgCost: p.avg_cost,
    invested: p.total_invested,
  }
}

export function buildHoldings(input: {
  positions: Position[]
  onPositions: ONPosition[]
  cedearTickers: string[]
  names: Record<string, string>
  total: number
}): HoldingRow[] {
  const cedears = new Set(input.cedearTickers)
  const rows = [
    ...input.positions.map(p => toRow(p, cedears.has(p.ticker) ? 'cedear' : 'stock', input.names, input.total)),
    ...input.onPositions.map(p => toRow(p, 'on', input.names, input.total)),
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

export function distribution(summary: PortfolioSummary): { label: string; pct: number; value: number }[] {
  const total = summary.total_market_value
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0)
  return [
    { label: 'Acciones y CEDEARs', value: summary.stocks.market_value },
    { label: 'Caja', value: summary.cash.balance },
    { label: 'Obligaciones negociables', value: summary.ons.market_value },
  ].map(d => ({ label: d.label, pct: pct(d.value), value: d.value }))
}
