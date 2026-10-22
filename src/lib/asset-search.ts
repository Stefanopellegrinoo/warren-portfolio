export interface CatalogEntry { ticker: string; nombre: string }
export interface AssetResult { ticker: string; name: string | null; held: boolean }

/**
 * Ranks assets for the Ctrl K search. An empty query lists what you hold; otherwise
 * exact ticker, then ticker prefix, then a name containing the query.
 */
export function searchAssets(query: string, held: string[], catalog: CatalogEntry[], limit = 8): AssetResult[] {
  const names = new Map(
    catalog
      .filter(c => c.nombre && c.nombre.trim().toUpperCase() !== c.ticker.toUpperCase())
      .map(c => [c.ticker.toUpperCase(), c.nombre]),
  )
  const heldSet = new Set(held.map(t => t.toUpperCase()))
  const q = query.trim().toUpperCase()

  if (!q) {
    return [...heldSet].slice(0, limit).map(t => ({ ticker: t, name: names.get(t) ?? null, held: true }))
  }

  const universe = new Set([...heldSet, ...catalog.map(c => c.ticker.toUpperCase())])
  const rank = (t: string): number => {
    if (t === q) return 0
    if (t.startsWith(q)) return 1
    if ((names.get(t) ?? '').toUpperCase().includes(q)) return 2
    return -1
  }

  return [...universe]
    .map(t => ({ t, r: rank(t) }))
    .filter(x => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.t.localeCompare(b.t))
    .slice(0, limit)
    .map(({ t }) => ({ ticker: t, name: names.get(t) ?? null, held: heldSet.has(t) }))
}
