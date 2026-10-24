import { describe, it, expect, afterEach } from 'vitest'
import { DrawingManager } from 'lightweight-charts-drawing'
import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts'

// The drawing layer patched at install time (scripts/patch-drawing-lib.mjs): finger-sized
// hit areas for touch, the library's own sizes for the mouse (odd/tasks/grafico-celular.md S4).

afterEach(() => { document.body.innerHTML = '' })

// The smallest chart the drawing layer runs on: price = 300 - y, time = x.
function setup() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const stub = () => {}
  const chart = {
    chartElement: () => el,
    timeScale: () => ({
      timeToCoordinate: (t: number) => t, coordinateToTime: (x: number) => x, logicalToCoordinate: () => null,
      subscribeVisibleLogicalRangeChange: stub, unsubscribeVisibleLogicalRangeChange: stub,
    }),
    priceScale: () => ({ width: () => 0, options: () => ({ mode: 0 }) }),
    paneSize: () => ({ width: 400, height: 300 }),
    options: () => ({ handleScroll: true, handleScale: true }),
    applyOptions: stub,
  }
  const series = {
    attachPrimitive: stub, detachPrimitive: stub, data: () => [],
    priceToCoordinate: (p: number) => 300 - p, coordinateToPrice: (y: number) => 300 - y,
    getPane: () => ({ paneIndex: () => 0, getHTMLElement: () => el }),
    priceScale: () => ({ options: () => ({ mode: 0 }) }),
  }
  const manager = new DrawingManager(chart as unknown as IChartApi, series as unknown as ISeriesApi<SeriesType>)
  // A horizontal line at price 150, so at y = 150.
  const id = manager.add({ kind: 'horizontal-line', points: [{ time: 100, price: 150 }] } as never)
  const press = (y: number, pointerType: string) => {
    const e = new MouseEvent('pointerdown', { clientX: 200, clientY: y, button: 0, bubbles: true })
    Object.defineProperty(e, 'pointerType', { value: pointerType })
    el.dispatchEvent(e)
    window.dispatchEvent(new MouseEvent('pointerup'))
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
