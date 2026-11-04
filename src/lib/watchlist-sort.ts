/** The Gráficos watchlist's sortable columns (odd/tasks/extended-hours.md S4). */
export type WatchlistSortKey = 'symbol' | 'price' | 'pct' | 'ext'
export interface WatchlistSort { key: WatchlistSortKey; dir: 'asc' | 'desc' }
type Values = Partial<Record<Exclude<WatchlistSortKey, 'symbol'>, number | null>>

/** A header click: A→Z for the symbol and highest first for numbers, then reversed, then the list's own order (null). */
export function nextSort(sort: WatchlistSort | null, key: WatchlistSortKey): WatchlistSort | null {
  const first = key === 'symbol' ? 'asc' : 'desc'
  if (sort?.key !== key) return { key, dir: first }
  return sort.dir === first ? { key, dir: first === 'asc' ? 'desc' : 'asc' } : null
}

/** Rows without a value go last in either direction; no sort keeps the list's own order. */
export function sortSymbols(symbols: string[], rows: Record<string, Values | undefined>, sort: WatchlistSort | null): string[] {
  if (!sort) return symbols
  const sign = sort.dir === 'asc' ? 1 : -1
  return [...symbols].sort((a, b) => {
    if (sort.key === 'symbol') return sign * a.localeCompare(b)
    const x = rows[a]?.[sort.key] ?? null
    const y = rows[b]?.[sort.key] ?? null
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
    return sign * (x - y)
  })
}
