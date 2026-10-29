// odd/tasks/chart-pro-redesign.md S1: the price pane keeps about half the height, the indicator panes share the
// rest equally, a minimized pane is a thin strip; S7: on a phone the panes keep a legible minimum.
import { describe, it, expect } from 'vitest'
import { MINIMIZED_PANE_PX, paneHeights, paneTops } from '../pane-layout'

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

describe('paneHeights', () => {
  it('with no indicator panes the price takes everything', () => {
    expect(paneHeights(600, false, [])).toEqual([600])
  })

  it('on a computer the price keeps about 56 % and the open panes share the rest equally', () => {
    const [price, ...panes] = paneHeights(1000, false, [false, false, false])

    expect(price).toBeCloseTo(560)
    expect(panes).toEqual([panes[0], panes[0], panes[0]])
    expect(panes[0]).toBeCloseTo(440 / 3)
  })

  it('on a phone the price keeps about half', () => {
    const [price, ...panes] = paneHeights(800, true, [false, false, false])

    expect(price).toBeCloseTo(400)
    expect(panes[0]).toBeCloseTo(400 / 3)
  })

  it('an open pane is never taller than 150 px: the price keeps what is left', () => {
    expect(paneHeights(1000, false, [false])).toEqual([850, 150])
  })

  it('an open pane keeps its minimum (72 px on a computer, 58 on a phone) while the price keeps 40 %', () => {
    // 600 × 44 % / 4 = 66 and 400 × 50 % / 4 = 50: both under their minimum, the price still over 40 %.
    expect(paneHeights(600, false, [false, false, false, false])).toEqual([312, 72, 72, 72, 72])
    expect(paneHeights(400, true, [false, false, false, false])).toEqual([168, 58, 58, 58, 58])
  })

  it('under their minimum before the price falls under 40 %', () => {
    const [price, ...panes] = paneHeights(400, false, [false, false, false, false, false])

    expect(price).toBeCloseTo(160)
    panes.forEach((p) => expect(p).toBeCloseTo(48))
  })

  it('a minimized pane is a 24 px strip, and the open ones share the room it leaves', () => {
    const heights = paneHeights(1000, false, [false, true, false])

    expect(heights[2]).toBe(MINIMIZED_PANE_PX)
    expect(heights[1]).toBe(heights[3])
    expect(sum(heights)).toBeCloseTo(1000)
  })

  it('every pane minimized: the price takes the rest', () => {
    expect(paneHeights(500, false, [true, true])).toEqual([452, 24, 24])
  })
})

describe('paneTops', () => {
  it("each pane starts under the one before it and its 1 px separator", () => {
    expect(paneTops([300, 100, 24])).toEqual([0, 301, 402])
  })
})
