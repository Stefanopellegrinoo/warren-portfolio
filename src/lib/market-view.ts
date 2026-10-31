import type { Currency } from './multicurrency'
import type { MarketBoard, MarketRow } from './market-board'
import { lineOf, storedSymbolFor } from './list-symbols'

/** The market's own lists on /mercado (odd/tasks/market-page.md S2); any other list key is a watchlist id or Cartera. */
export type MarketList = 'lider' | 'cedears'

/** One row of the /mercado table, whatever list it comes from. */
export interface ViewRow {
  key: string
  /** What the row shows: the BYMA line, or the stored symbol when it has none. */
  ticker: string
  /** The symbol lists store and the Gráfico / Ficha links use (`BCBA:GGAL`, `AAPL`, `BTCUSDT`). */
  stored: string
  name: string | null
  /** Pesos, from the BYMA peso line. */
  price: number | null
  /** Fraction (0.034 = 3.4 %), the peso line's own change, shown in every currency. */
  changePct: number | null
  /** Why a row has no BYMA price. */
  note: string | null
  /** The BYMA line the star adds or removes; null when the asset does not trade on BYMA. */
  line: { kind: 'local' | 'cedear'; line: string } | null
}

export type SortKey = 'ticker' | 'price' | 'change'
export interface Sort { key: SortKey; dir: 'asc' | 'desc' }
export interface View { list: string; sort: Sort }

export const DEFAULT_LIST = 'lider'
export const DEFAULT_SORT: Sort = { key: 'change', dir: 'desc' }
const SORT_KEYS: SortKey[] = ['ticker', 'price', 'change']

const fromLine = (kind: 'local' | 'cedear', r: MarketRow): ViewRow => {
  const stored = storedSymbolFor(kind, r.symbol)
  return { key: stored, ticker: r.symbol, stored, name: r.name, price: r.price, changePct: r.changePct, note: null, line: { kind, line: r.symbol } }
}

const withoutLine = (stored: string, note: string): ViewRow =>
  ({ key: stored, ticker: stored, stored, name: null, price: null, changePct: null, note, line: null })

export function marketRows(board: MarketBoard, list: MarketList): ViewRow[] {
  return list === 'lider' ? board.lider.map((r) => fromLine('local', r)) : board.cedears.map((r) => fromLine('cedear', r))
}

/** A watchlist or Cartera as rows: each stored symbol priced by its BYMA peso line, one row per asset. */
export function listRows(stored: string[], board: MarketBoard): ViewRow[] {
  const locals = new Map(board.locals.map((r) => [r.symbol, r]))
  const cedears = new Map(board.cedears.map((r) => [r.symbol, r]))
  const symbols = { locals: new Set(locals.keys()), cedears: new Set(cedears.keys()) }
  const rows = new Map<string, ViewRow>()
  for (const s of stored) {
    const l = lineOf(s, symbols)
    const row = l.kind === 'local' ? fromLine('local', locals.get(l.line)!)
      : l.kind === 'cedear' ? fromLine('cedear', cedears.get(l.line)!)
        : l.kind === 'adr' ? withoutLine(s, 'ADR en EE.UU., no cotiza en BYMA')
          : withoutLine(s, 'No cotiza en BYMA')
    if (!rows.has(row.key)) rows.set(row.key, row)
  }
  return [...rows.values()]
}

/** Pesos as they are; MEP and cable are pesos ÷ the day's rate, as the Resumen converts. */
export function inCurrency(ars: number | null, currency: Currency, fx: { mep: number | null; ccl: number | null }): number | null {
  if (ars === null) return null
  if (currency === 'ARS') return ars
  const rate = currency === 'MEP' ? fx.mep : fx.ccl
  return rate ? ars / rate : null
}

// Pesos order the rows the same as either dollar: the rate divides every price alike.
const valueOf = (r: ViewRow, key: SortKey) => (key === 'price' ? r.price : r.changePct)

/** Rows without a value go last in either direction. */
export function sortRows(rows: ViewRow[], sort: Sort): ViewRow[] {
  const sign = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    if (sort.key === 'ticker') return sign * a.ticker.localeCompare(b.ticker)
    const x = valueOf(a, sort.key)
    const y = valueOf(b, sort.key)
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
    return sign * (x - y)
  })
}

const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export function filterRows(rows: ViewRow[], query: string): ViewRow[] {
  const q = plain(query.trim())
  if (!q) return rows
  return rows.filter((r) => plain(r.ticker).includes(q) || (r.name !== null && plain(r.name).includes(q)))
}

export function parseView(params: URLSearchParams): View {
  const [key, dir] = (params.get('orden') ?? '').split(':')
  const sort: Sort = SORT_KEYS.includes(key as SortKey) && (dir === 'asc' || dir === 'desc') ? { key: key as SortKey, dir } : DEFAULT_SORT
  return { list: params.get('lista') || DEFAULT_LIST, sort }
}

export function serializeView(view: View): string {
  const q = new URLSearchParams()
  if (view.list !== DEFAULT_LIST) q.set('lista', view.list)
  if (view.sort.key !== DEFAULT_SORT.key || view.sort.dir !== DEFAULT_SORT.dir) q.set('orden', `${view.sort.key}:${view.sort.dir}`)
  return q.toString()
}
