/**
 * A trade in today's share basis (odd/tasks/split-aware-ledger.md S5). Trades are stored as traded;
 * a stock or CEDEAR row dated before stored splits also carries what it is after them, and
 * Historial and the chart's trade cards say it under the row. Client-safe: no server imports.
 */
import type { SplitEvent } from './historical-prices'
import type { Transaction } from '@/types'
import { qtyText } from './chart/trade-markers'
import { formatDate, formatUSD } from './utils'

/** Engine units: underlying shares and USD. */
export interface AfterSplits {
  splits: SplitEvent[]
  factor: number
  quantity: number
  price: number
}

/**
 * The row after the stored splits dated after it (a split applies from its date: a trade on the
 * ex-date is already on the new basis); undefined for an ON or when none came after.
 */
export function afterSplits(
  row: Pick<Transaction, 'ticker' | 'date' | 'quantity' | 'price' | 'asset_type' | 'operation'>,
  splitsByTicker: ReadonlyMap<string, readonly SplitEvent[]>,
): AfterSplits | undefined {
  // Buys and sales only: a dividend's price is income per share, not a share price.
  if (row.asset_type === 'ON' || (row.operation !== 'COMPRA' && row.operation !== 'VENTA')) return undefined
  const day = row.date.slice(0, 10)
  const splits = (splitsByTicker.get(row.ticker.trim().toUpperCase()) ?? []).filter((s) => s.date > day)
  if (splits.length === 0) return undefined
  const factor = splits.reduce((f, s) => f * (s.numerator / s.denominator), 1)
  return { splits, factor, quantity: Math.abs(row.quantity) * factor, price: row.price / factor }
}

/** "Tras el split 20:1 del 18/07/2022: 18,62 acciones a US$ 129,58"; several: ", " between them and " y " before the last. */
export function afterSplitsText({ splits, quantity, price }: AfterSplits): string {
  const items = splits.map((s) => `${s.numerator}:${s.denominator} del ${formatDate(s.date)}`)
  const list = items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
  return `Tras ${items.length === 1 ? 'el split' : 'los splits'} ${list}: ${qtyText(quantity)} acciones a ${formatUSD(price)}`
}
