import { describe, it, expect } from 'vitest'
import { treemap } from '../treemap'

const area = (r: { w: number; h: number }) => r.w * r.h

describe('treemap', () => {
  it('fills the whole box with one rectangle per item, sized by weight', () => {
    const rects = treemap([{ id: 'a', weight: 66.7 }, { id: 'b', weight: 15.3 }, { id: 'c', weight: 15.1 }, { id: 'd', weight: 2.9 }], 2)
    expect(rects.map(r => r.id).sort()).toEqual(['a', 'b', 'c', 'd'])
    const total = rects.reduce((s, r) => s + area(r), 0)
    expect(total).toBeCloseTo(1, 9)
    for (const [id, w] of [['a', 66.7], ['b', 15.3], ['c', 15.1], ['d', 2.9]] as const) {
      expect(area(rects.find(r => r.id === id)!)).toBeCloseTo(w / 100, 9)
    }
  })

  it('never lets rectangles overlap or leave the box', () => {
    const rects = treemap([5, 4, 3, 2, 1, 1].map((weight, i) => ({ id: String(i), weight })), 1.6)
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.y).toBeGreaterThanOrEqual(0)
      expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-9)
      expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-9)
    }
    for (const a of rects) for (const b of rects) {
      if (a === b) continue
      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
      expect(overlapX <= 1e-9 || overlapY <= 1e-9).toBe(true)
    }
  })

  it('splits a wide box side by side, the biggest item first', () => {
    const [first, second] = treemap([{ id: 'small', weight: 1 }, { id: 'big', weight: 3 }], 2)
    expect(first).toMatchObject({ id: 'big', x: 0, y: 0, w: 0.75, h: 1 })
    expect(second).toMatchObject({ id: 'small', x: 0.75, y: 0, w: 0.25, h: 1 })
  })

  it('stacks items in a tall box', () => {
    const [first, second] = treemap([{ id: 'a', weight: 1 }, { id: 'b', weight: 1 }], 0.5)
    expect(first).toMatchObject({ x: 0, y: 0, w: 1, h: 0.5 })
    expect(second).toMatchObject({ x: 0, y: 0.5, w: 1, h: 0.5 })
  })

  it('returns nothing when there is nothing to draw', () => {
    expect(treemap([], 2)).toEqual([])
    expect(treemap([{ id: 'zero', weight: 0 }], 2)).toEqual([])
  })
})
