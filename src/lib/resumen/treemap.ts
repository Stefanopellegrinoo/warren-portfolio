export interface Tile { id: string; x: number; y: number; w: number; h: number }

/**
 * Lays weighted items out as a treemap in a unit box (x, y, w, h all in 0..1).
 * `aspect` is the box's real width / height, so cuts go across its longer real side.
 * ponytail: binary split into halves of similar weight, not squarified; fine for a handful of classes.
 */
export function treemap(items: { id: string; weight: number }[], aspect: number): Tile[] {
  const sorted = items.filter(i => i.weight > 0).sort((a, b) => b.weight - a.weight)
  const tiles: Tile[] = []
  split(sorted, { x: 0, y: 0, w: 1, h: 1 }, aspect, tiles)
  return tiles
}

function split(items: { id: string; weight: number }[], box: Omit<Tile, 'id'>, aspect: number, out: Tile[]) {
  if (items.length === 0) return
  if (items.length === 1) { out.push({ id: items[0].id, ...box }); return }

  const total = items.reduce((s, i) => s + i.weight, 0)
  // The prefix whose weight is closest to half.
  let cut = 1, acc = 0, best = Infinity
  for (let i = 0; i < items.length - 1; i++) {
    acc += items[i].weight
    const gap = Math.abs(total / 2 - acc)
    if (gap < best) { best = gap; cut = i + 1 }
  }
  const share = items.slice(0, cut).reduce((s, i) => s + i.weight, 0) / total
  const { x, y, w, h } = box
  if (w * aspect >= h) {
    split(items.slice(0, cut), { x, y, w: w * share, h }, aspect, out)
    split(items.slice(cut), { x: x + w * share, y, w: w * (1 - share), h }, aspect, out)
  } else {
    split(items.slice(0, cut), { x, y, w, h: h * share }, aspect, out)
    split(items.slice(cut), { x, y: y + h * share, w, h: h * (1 - share) }, aspect, out)
  }
}
