import { describe, it, expect, afterEach } from 'vitest'
import { touchDrawing } from '../touch-drawing'
import { drag, fakeChart, pointer, tap } from './fake-chart'

// time = x and price = 300 - y on the fake chart.
const at = (d: { points: { time: unknown; price: number }[] }) => d.points.map(p => [p.time, Math.round(p.price)])

const cleanups: (() => void)[] = []
afterEach(() => { cleanups.splice(0).forEach(c => c()); document.body.innerHTML = '' })

function setup(tool: Parameters<ReturnType<typeof fakeChart>['manager']['setTool']>[0]) {
  const { el, manager } = fakeChart()
  cleanups.push(touchDrawing(manager, el))
  manager.setTool(tool)
  return { el, manager }
}

describe('drawing with a finger (S2)', () => {
  it('dragging draws a line from where the finger lands to where it lifts', () => {
    const { el, manager } = setup('trend-line')

    drag(el, [100, 200], [250, 100])

    expect(manager.drawings()).toHaveLength(1)
    expect(manager.drawings()[0].kind).toBe('trend-line')
    expect(at(manager.drawings()[0])).toEqual([[100, 100], [250, 200]])
    expect(manager.tool()).toBeNull()
  })

  it('the line follows the finger while it drags', () => {
    const { el, manager } = setup('trend-line')
    const hovers: number[] = []
    el.addEventListener('pointermove', e => { if (e.buttons === 0) hovers.push(e.clientX) })

    pointer(el, 'pointerdown', 100, 200)
    pointer(el, 'pointermove', 140, 180)
    pointer(el, 'pointermove', 180, 160)

    expect(hovers).toEqual([140, 180])
    expect(manager.drawings()).toHaveLength(0)
  })

  it('tapping one point and then another still draws the line', () => {
    const { el, manager } = setup('trend-line')

    tap(el, [100, 200])
    tap(el, [250, 100])

    expect(manager.drawings()).toHaveLength(1)
    expect(at(manager.drawings()[0])).toEqual([[100, 100], [250, 200]])
  })

  it('a one-point tool places where the finger lands and leaves nothing pending', () => {
    const { el, manager } = setup('horizontal-line')

    drag(el, [100, 200], [250, 100])
    tap(el, [300, 250])

    expect(manager.drawings()).toHaveLength(1)
    expect(at(manager.drawings()[0])).toEqual([[100, 100]])
  })

  it('a three-point tool takes the drag as its first two points and a tap as the third', () => {
    const { el, manager } = setup('parallel-channel')

    drag(el, [100, 200], [250, 100])
    expect(manager.drawings()).toHaveLength(0)
    tap(el, [250, 150])

    expect(manager.drawings()).toHaveLength(1)
    expect(manager.drawings()[0].kind).toBe('parallel-channel')
  })

  it('the brush keeps drawing one stroke per drag', () => {
    const { el, manager } = setup('brush')

    drag(el, [100, 200], [250, 100])

    expect(manager.drawings()).toHaveLength(1)
    expect(manager.drawings()[0].kind).toBe('brush')
  })

  it('the mouse keeps clicking point after point: a drag places only the first one', () => {
    const { el, manager } = setup('trend-line')

    drag(el, [100, 200], [250, 100], 'mouse')

    expect(manager.drawings()).toHaveLength(0)
    expect(manager.tool()).toBe('trend-line')
  })

  it('a second finger (a pinch) cancels the point being placed instead of drawing between the fingers', () => {
    const { el, manager } = setup('trend-line')

    pointer(el, 'pointerdown', 100, 200, 'touch', 1)
    pointer(el, 'pointerdown', 250, 100, 'touch', 2)
    pointer(el, 'pointerup', 250, 100, 'touch', 2)
    pointer(el, 'pointerup', 100, 200, 'touch', 1)
    expect(manager.drawings()).toHaveLength(0)
    expect(manager.tool()).toBe('trend-line')

    tap(el, [150, 150])
    expect(manager.drawings()).toHaveLength(0) // that tap is a first point, not the end of a stray line
  })
})
