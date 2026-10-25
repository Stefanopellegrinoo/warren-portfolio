import { describe, it, expect, afterEach } from 'vitest'
import type { DrawingManager } from 'lightweight-charts-drawing'
import { selectBeforeMove } from '../select-before-move'
import { touchDrawing } from '../touch-drawing'
import { drag, fakeChart, tap } from './fake-chart'

// odd/tasks/chart-customization.md S1: with a finger, a drawing is selected before it moves.
// time = x and price = 300 - y on the fake chart.
const at = (d: { points: { time: unknown; price: number }[] } | undefined) => d!.points.map(p => [p.time, Math.round(p.price)])
// The drawing layer holds the chart still (no pan) while it owns a press.
const held = (applied: unknown[]) => applied.some(o => (o as { handleScroll?: unknown }).handleScroll === false)

const cleanups: (() => void)[] = []
afterEach(() => { cleanups.splice(0).forEach(c => c()); document.body.innerHTML = '' })

// A trend line from (100, 150) to (200, 120) on screen: its body passes through (150, 135).
const BODY: [number, number] = [150, 135]
const POINT: [number, number] = [100, 150]
const EMPTY: [number, number] = [350, 280]
const START = [[100, 150], [200, 180]]

function setup() {
  let manager: DrawingManager | null = null
  const chart = fakeChart(el => cleanups.push(selectBeforeMove(el, () => manager)))
  manager = chart.manager
  cleanups.push(touchDrawing(chart.manager, chart.el))
  const id = chart.manager.add({ kind: 'trend-line', points: [{ time: 100, price: 150 }, { time: 200, price: 180 }] } as never)
  return { ...chart, id }
}

describe('a finger over a drawing that is not selected', () => {
  it('dragging across its line leaves it where it is, unselected, and the chart free to pan', () => {
    const { el, manager, applied, id } = setup()

    drag(el, BODY, [150, 60])

    expect(at(manager.get(id))).toEqual(START)
    expect(manager.selection()).toEqual([])
    expect(held(applied)).toBe(false)
  })

  it('dragging from one of its points does not reshape it', () => {
    const { el, manager, applied, id } = setup()

    drag(el, POINT, [50, 50])

    expect(at(manager.get(id))).toEqual(START)
    expect(manager.selection()).toEqual([])
    expect(held(applied)).toBe(false)
  })

  it('a tap selects it without moving it', () => {
    const { el, manager, id } = setup()

    tap(el, BODY)

    expect(manager.selection()).toEqual([id])
    expect(at(manager.get(id))).toEqual(START)
  })

  it('a tap 12px off its line still selects it: finger-sized, as before', () => {
    const { el, manager, id } = setup()

    tap(el, [150, 147])

    expect(manager.selection()).toEqual([id])
  })
})

describe('a finger on the selected drawing', () => {
  it('dragging its body moves it', () => {
    const { el, manager, id } = setup()
    tap(el, BODY)

    drag(el, BODY, [150, 85])

    expect(at(manager.get(id))).toEqual([[100, 200], [200, 230]])
    expect(manager.selection()).toEqual([id])
  })

  it('dragging one of its points reshapes it', () => {
    const { el, manager, id } = setup()
    tap(el, BODY)

    drag(el, POINT, [100, 100])

    expect(at(manager.get(id))).toEqual([[100, 200], [200, 180]])
  })

  it('a locked one stays put, and the drag pans the chart instead', () => {
    const { el, manager, applied, id } = setup()
    manager.update({ ...manager.get(id)!, locked: true })
    tap(el, BODY)
    expect(manager.selection()).toEqual([id])

    drag(el, BODY, [150, 85])

    expect(at(manager.get(id))).toEqual(START)
    expect(manager.selection()).toEqual([id])
    expect(held(applied)).toBe(false)
  })
})

describe('a finger on an empty part of the chart', () => {
  it('a tap deselects', () => {
    const { el, manager } = setup()
    tap(el, BODY)

    tap(el, EMPTY)

    expect(manager.selection()).toEqual([])
  })

  it('panning keeps the selection, so the drawing can be dragged next', () => {
    const { el, manager, id } = setup()
    tap(el, BODY)

    drag(el, EMPTY, [250, 280])

    expect(manager.selection()).toEqual([id])
  })
})

describe('what does not change', () => {
  it('the mouse still reshapes a drawing it is not selected by dragging one of its points', () => {
    const { el, manager, id } = setup()

    drag(el, POINT, [100, 100], 'mouse')

    expect(at(manager.get(id))).toEqual([[100, 200], [200, 180]])
  })

  it('the mouse selects on the press and holds the chart, and then moves the drawing by its body', () => {
    const { el, manager, applied, id } = setup()

    drag(el, BODY, [150, 85], 'mouse')
    expect(manager.selection()).toEqual([id])
    expect(held(applied)).toBe(true)

    drag(el, BODY, [150, 85], 'mouse')
    expect(at(manager.get(id))).toEqual([[100, 200], [200, 230]])
  })

  it('the mouse deselects on a press off the drawings', () => {
    const { el, manager } = setup()
    tap(el, BODY, 'mouse')

    drag(el, EMPTY, [250, 280], 'mouse')

    expect(manager.selection()).toEqual([])
  })

  it('with a tool armed, a finger drag draws, even when it starts on a drawing', () => {
    const { el, manager } = setup()
    manager.setTool('trend-line')

    drag(el, BODY, [300, 50])

    expect(manager.drawings()).toHaveLength(2)
    expect(at(manager.drawings()[1])).toEqual([[150, 165], [300, 250]])
  })
})
