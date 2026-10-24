import { DrawingManager } from 'lightweight-charts-drawing'
import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts'

/** The smallest chart the drawing layer runs on in jsdom: time = x, price = 300 - y. */
export function fakeChart() {
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
  return { el, manager }
}

/** A pointer event as the browser sends it; moves and lifts bubble to window like real ones. */
export function pointer(el: HTMLElement, type: string, x: number, y: number, pointerType = 'touch', pointerId = 1) {
  const down = type === 'pointerdown' || type === 'pointermove'
  el.dispatchEvent(new PointerEvent(type, {
    clientX: x, clientY: y, pointerType, pointerId, button: 0, buttons: down ? 1 : 0, bubbles: true, cancelable: true,
  }))
}

export function drag(el: HTMLElement, from: [number, number], to: [number, number], pointerType = 'touch') {
  pointer(el, 'pointerdown', ...from, pointerType)
  for (let i = 1; i <= 4; i++) pointer(el, 'pointermove', from[0] + (to[0] - from[0]) * i / 4, from[1] + (to[1] - from[1]) * i / 4, pointerType)
  pointer(el, 'pointerup', ...to, pointerType)
}

export function tap(el: HTMLElement, at: [number, number], pointerType = 'touch') {
  pointer(el, 'pointerdown', ...at, pointerType)
  pointer(el, 'pointerup', ...at, pointerType)
}
