import { describe, it, expect } from 'vitest'
import { fromLegacyDrawings } from '../legacy-drawings'

const row = (type: string, points: { time: number; price: number }[], extra: object = {}) => ({
  id: `id-${type}`,
  type,
  points,
  style: {},
  ...extra,
})

const p1 = { time: 1743379200, price: 546.87 }
const p2 = { time: 1775174400, price: 735.09 }
const p3 = { time: 1761523200, price: 685.54 }

describe('fromLegacyDrawings', () => {
  it('maps every legacy type to its drawing-core kind, keeping id and points', () => {
    const out = fromLegacyDrawings([
      row('hline', [p1]),
      row('horizontal_ray', [p1]),
      row('trendline', [p1, p2]),
      row('ray', [p1, p2]),
      row('fibonacci', [p1, p2]),
      row('price_range', [p1, p2]),
      row('arrow', [p1, p2]),
      row('channel', [p1, p2, p3]),
    ])

    expect(out.map((d) => [d.id, d.kind, d.points])).toEqual([
      ['id-hline', 'horizontal-line', [p1]],
      ['id-horizontal_ray', 'horizontal-ray', [p1]],
      ['id-trendline', 'trend-line', [p1, p2]],
      ['id-ray', 'ray', [p1, p2]],
      ['id-fibonacci', 'fib-retracement', [p1, p2]],
      ['id-price_range', 'price-range', [p1, p2]],
      ['id-arrow', 'arrow', [p1, p2]],
      ['id-channel', 'parallel-channel', [p1, p2, p3]],
    ])
  })

  it('gives each drawing the kind default style and carries the old color and width over', () => {
    const [d] = fromLegacyDrawings([row('trendline', [p1, p2], { style: { color: '#ff0000', lineWidth: 3 } })])

    expect(d.style).toMatchObject({ color: '#ff0000', width: 3 })
  })

  it('keeps the legacy label as the drawing name', () => {
    const [d] = fromLegacyDrawings([row('hline', [p1], { label: 'soporte' })])

    expect(d.name).toBe('soporte')
  })

  it('skips an unknown type or a row with the wrong number of points instead of failing the whole list', () => {
    const out = fromLegacyDrawings([row('spiral', [p1]), row('channel', [p1, p2]), row('hline', [p1])])

    expect(out.map((d) => d.kind)).toEqual(['horizontal-line'])
  })
})
