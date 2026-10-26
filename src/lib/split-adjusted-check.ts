/**
 * The split-adjusted entry guard (odd/tasks/split-aware-ledger.md S4).
 *
 * Rows are stored as traded (S2) and every computation applies the splits after them, so a
 * pre-split trade entered with Yahoo's split-adjusted numbers would create phantom shares
 * (×20 for GOOGL). A trade is refused when its price sits closer to Yahoo's adjusted close of
 * that day than to the real one. Market data never blocks a write: no bar within 7 days,
 * Yahoo failing, a failed market read or no stored split after the date skips the check.
 *
 * WORKER-SAFE: relative value imports only (the import worker validates through here).
 */
import type { BarsResult } from './bars-cache'
import { getBars } from './bars-cache'
import { closeOnOrBefore } from './daily-bars'
import type { SplitEvent } from './historical-prices'
import { num } from './ledger-write'
import { loadSplits } from './stock-splits'
import { listCatalogued, yahooSymbols } from './ticker-catalog'

/** A split factor this close to 1 moves the price too little to tell the two bases apart. */
const MIN_FACTOR = 1.5
const MAX_BAR_AGE_DAYS = 7
const DAY_MS = 86_400_000

export interface TradeToCheck { ticker: string; date: string; quantity: number; price: number }

export class SplitAdjustedError extends Error {
  /** Read by every route's `status === 400` branch. */
  readonly status = 400
  constructor(readonly ticker: string, message: string) {
    super(message)
    this.name = 'SplitAdjustedError'
  }
}

const price2 = (n: number) => String(Number(n.toFixed(2)))
const daysBefore = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10)
/** Splits apply at the start of their date: a trade on the ex-date is already on the new basis. */
const after = (splits: SplitEvent[], date: string) => splits.filter(s => s.date > date)
const factorOf = (splits: SplitEvent[]) => splits.reduce((f, s) => f * s.numerator / s.denominator, 1)
const applies = (f: number) => f >= MIN_FACTOR || f <= 1 / MIN_FACTOR

function splitsText(splits: SplitEvent[]): string {
  const items = splits.map(s => `${s.numerator}:${s.denominator} del ${s.date}`)
  if (items.length === 1) return `el split ${items[0]}`
  return `los splits ${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}

/**
 * Pure: the refusal message when `trade` looks split-adjusted, else null.
 * `splits` = the ticker's stored splits; `bars` = Yahoo's chart for its symbol (adjusted closes).
 */
export function splitAdjustedMessage(trade: TradeToCheck, splits: SplitEvent[], bars: BarsResult | undefined): string | null {
  const stored = after(splits, trade.date)
  const f = factorOf(stored)
  if (!applies(f) || !bars || bars.degraded || bars.missing) return null
  const minDay = daysBefore(trade.date, MAX_BAR_AGE_DAYS)
  const close = closeOnOrBefore(bars.bars.filter(b => b.date >= minDay), trade.date)
  if (close === null) return null
  const real = close * (bars.splitsKnown ? factorOf(after(bars.splits, trade.date)) : f)
  if (!(Math.abs(Math.log(trade.price / close)) < Math.abs(Math.log(trade.price / real)))) return null
  return `El precio de ${trade.ticker} el ${trade.date} (${price2(trade.price)}) parece ajustado por ${splitsText(stored)}: ese día cotizaba cerca de ${price2(real)}. `
    + `Cargala como figura en tu comprobante: ${num(trade.quantity / f)} a ${price2(trade.price * f)}.`
}

/**
 * Throws SplitAdjustedError for the first trade (in the given order) that looks split-adjusted.
 * Only buys and sales of non-ON tickers with a non-.BA Yahoo symbol are checked.
 */
export async function assertNotSplitAdjusted(
  trades: Array<TradeToCheck & { operation: string; assetType?: string | null }>,
): Promise<void> {
  const traded = trades
    .filter(t => (t.operation === 'COMPRA' || t.operation === 'VENTA') && t.assetType !== 'ON')
    .map(t => ({ ticker: t.ticker.trim().toUpperCase(), date: t.date, quantity: Math.abs(t.quantity), price: t.price }))
  if (traded.length === 0) return

  let refused: { ticker: string; message: string } | undefined
  try {
    const splits = await loadSplits()
    const checked = traded.filter(t => applies(factorOf(after(splits.get(t.ticker) ?? [], t.date))))
    if (checked.length === 0) return
    const symbols = yahooSymbols(Array.from(new Set(checked.map(t => t.ticker))), await listCatalogued(null))
    const usd = checked.filter(t => !/\.BA$/i.test(symbols.get(t.ticker) ?? ''))
    if (usd.length === 0) return
    const from = daysBefore(usd.map(t => t.date).sort()[0], MAX_BAR_AGE_DAYS)
    const bars = await getBars(usd.map(t => symbols.get(t.ticker)!), new Date(`${from}T00:00:00Z`))
    for (const t of usd) {
      const message = splitAdjustedMessage(t, splits.get(t.ticker) ?? [], bars.get(symbols.get(t.ticker)!))
      if (message) { refused = { ticker: t.ticker, message }; break }
    }
  } catch (err) {
    console.warn('[SplitAdjusted] check skipped:', err instanceof Error ? err.message : err)
    return
  }
  if (refused) throw new SplitAdjustedError(refused.ticker, refused.message)
}
