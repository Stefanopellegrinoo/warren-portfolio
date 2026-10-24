export interface HistoryPoint { snapshot_date: string; value: number; invested: number }

export const RANGES = [
  { id: '1M', days: '30' },
  { id: '3M', days: '90' },
  { id: '6M', days: '180' },
  { id: '1A', days: '365' },
  { id: 'Todo', days: 'all' },
] as const

export type RangeId = (typeof RANGES)[number]['id']

/**
 * The points of `range`, cut from the whole series the way /api/portfolio-history cuts its window:
 * from `today` (an Argentine YYYY-MM-DD) minus the range's days, inclusive.
 */
export function pointsInRange(points: HistoryPoint[], range: RangeId, today: string): HistoryPoint[] {
  const days = RANGES.find(r => r.id === range)!.days
  if (days === 'all') return points
  const cutoff = new Date(`${today}T00:00:00Z`)
  cutoff.setUTCDate(cutoff.getUTCDate() - parseInt(days))
  const from = cutoff.toISOString().slice(0, 10)
  return points.filter(p => p.snapshot_date >= from)
}

/** Plot gutters: room for y labels on the left and date labels below. */
export const PLOT = { left: 44, top: 6, bottom: 22 }

const kLabel = (v: number) =>
  `${(v / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}k`

const shortDate = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })

function niceStep(range: number, target = 3): number {
  const raw = range / target
  const pow = 10 ** Math.floor(Math.log10(raw))
  const m = raw / pow
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * pow
}

export function buildChart(points: HistoryPoint[], width: number, height: number) {
  if (points.length === 0 || width <= PLOT.left) return null

  const all = points.flatMap(p => [p.value, p.invested]).filter(Number.isFinite)
  let lo = Math.min(...all)
  let hi = Math.max(...all)
  if (hi === lo) { lo -= Math.abs(lo) * 0.01 || 1; hi += Math.abs(hi) * 0.01 || 1 }
  const pad = (hi - lo) * 0.06
  lo -= pad
  hi += pad

  const plotH = height - PLOT.top - PLOT.bottom
  const last = Math.max(points.length - 1, 1)
  const xAt = (i: number) => PLOT.left + (i / last) * (width - PLOT.left)
  const yAt = (v: number) => PLOT.top + ((hi - v) / (hi - lo)) * plotH
  const path = (key: 'value' | 'invested') =>
    points.map((p, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(p[key]).toFixed(1)}`).join('')

  const step = niceStep(hi - lo)
  const yTicks: { y: number; label: string }[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) yTicks.push({ y: yAt(v), label: kLabel(v) })

  const idx = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])]
  const xTicks = idx.map(i => ({ x: xAt(i), label: shortDate(points[i].snapshot_date) }))

  return { valuePath: path('value'), investedPath: path('invested'), yTicks, xTicks, xAt, yAt }
}

export function nearestIndex(clientX: number, left: number, width: number, count: number): number {
  if (count <= 1 || width <= 0) return 0
  const i = Math.round(((clientX - left) / width) * (count - 1))
  return Math.min(Math.max(i, 0), count - 1)
}

export const HISTORY_NOTE = 'Toda la cartera: acciones, ONs y caja.'
