import { defaultStyleFor, type Drawing, type DrawingKind } from 'lightweight-charts-drawing'

/** A row of the old chart_drawings table, as GET /api/drawings returns it. */
export interface LegacyDrawing {
  id: string
  type: string
  points: { time: number; price: number }[]
  style?: { color?: string; lineWidth?: number }
  label?: string
}

const KIND: Record<string, { kind: DrawingKind; points: number }> = {
  hline: { kind: 'horizontal-line', points: 1 },
  horizontal_ray: { kind: 'horizontal-ray', points: 1 },
  trendline: { kind: 'trend-line', points: 2 },
  ray: { kind: 'ray', points: 2 },
  fibonacci: { kind: 'fib-retracement', points: 2 },
  price_range: { kind: 'price-range', points: 2 },
  arrow: { kind: 'arrow', points: 2 },
  channel: { kind: 'parallel-channel', points: 3 },
}

/** Brings the old per-row drawings into the drawing core's model, once per
 *  ticker. A row that does not fit is skipped, not allowed to sink the list. */
export function fromLegacyDrawings(rows: LegacyDrawing[]): Drawing[] {
  return rows.flatMap((r) => {
    const target = KIND[r.type]
    if (!target || r.points?.length !== target.points) return []
    const style = {
      ...defaultStyleFor(target.kind),
      ...(r.style?.color ? { color: r.style.color } : {}),
      ...(r.style?.lineWidth ? { width: r.style.lineWidth } : {}),
    }
    return [{ id: r.id, kind: target.kind, points: r.points, style, ...(r.label ? { name: r.label } : {}) } as Drawing]
  })
}
