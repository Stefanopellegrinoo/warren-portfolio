import { describe, it, expect, afterEach } from 'vitest'
import { fakeChart, pointer } from './fake-chart'

// The drawing layer patched at install time (scripts/patch-drawing-lib.mjs): finger-sized
// hit areas for touch, the library's own sizes for the mouse (odd/tasks/grafico-celular.md S4).

afterEach(() => { document.body.innerHTML = '' })

function setup() {
  const { el, manager } = fakeChart()
  // A horizontal line at price 150, so at y = 150.
  const id = manager.add({ kind: 'horizontal-line', points: [{ time: 100, price: 150 }] } as never)
  const press = (y: number, pointerType: string) => {
    pointer(el, 'pointerdown', 200, y, pointerType)
    pointer(el, 'pointerup', 200, y, pointerType)
  }
  return { manager, id, press }
}

describe('drawing hit areas', () => {
  it('a finger 12px off a line still selects it', () => {
    const { manager, id, press } = setup()

    press(162, 'touch')

    expect(manager.selection()).toEqual([id])
  })

  it('the mouse keeps the library precision: 12px off a line misses it', () => {
    const { manager, press } = setup()

    press(162, 'mouse')

    expect(manager.selection()).toEqual([])
  })

  it('the mouse still selects a line under the pointer', () => {
    const { manager, id, press } = setup()

    press(153, 'mouse')

    expect(manager.selection()).toEqual([id])
  })
})
