import { describe, it, expect, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import type { Series } from '@/lib/fundamentals/types'
import { LineChart } from '../LineChart'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// odd/tasks/asset-page.md L21 (c): gaps break the line; a far outlier is pinned to the edge. Invented numbers.
const s = (pairs: [string, number][]): Series => pairs.map(([end, value]) => ({ end, value }))
const TODAY = '2026-10-30'

let root: Root
let el: HTMLDivElement
function draw(series: Series, mode: 'quarterly' | 'ttm' | 'annual' = 'ttm') {
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  act(() => root.render(<LineChart series={series} unit="ratio" better="lower" mode={mode} today={TODAY} label="P/E" />))
  return el.querySelector('[role="img"]')!
}
afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ''
})

const plain = (t: string | null | undefined) => (t ?? '').replace(/[  ]/g, ' ')
const moves = (path: Element | null) => (path?.getAttribute('d')?.match(/M/g) ?? []).length
const line = () => el.querySelector('path[fill="none"]')
const area = () => el.querySelector('path:not([fill="none"])')

describe('LineChart gaps', () => {
  it('breaks the line and the area where periods are missing, never before hoy', () => {
    draw(s([['2019-03-31', 40], ['2019-06-30', 42], ['2021-09-30', 60], ['2021-12-31', 55], ['2022-03-31', 50], ['2026-06-30', 46], [TODAY, 44]]))
    // 2019-06-30 → 2021-09-30 and 2022-03-31 → 2026-06-30 are gaps; 2026-06-30 → hoy is not.
    expect(moves(line())).toBe(3)
    expect(moves(area())).toBe(3)
  })

  it('joins consecutive quarters, and consecutive years in annual mode', () => {
    draw(s([['2025-06-30', 1], ['2025-09-30', 2], ['2025-12-31', 3], ['2026-03-31', 4], [TODAY, 5]]))
    expect(moves(line())).toBe(1)
    act(() => root.unmount())
    draw(s([['2022-12-31', 1], ['2023-12-31', 2], ['2024-12-31', 3], ['2025-12-31', 4], [TODAY, 5]]), 'annual')
    expect(moves(line())).toBe(1)
    act(() => root.unmount())
    draw(s([['2017-12-31', 1], ['2021-12-31', 2], ['2022-12-31', 3], [TODAY, 4]]), 'annual')
    expect(moves(line())).toBe(2)
  })
})

describe('LineChart outliers', () => {
  const SPIKE = s([
    ['2019-06-30', 1925.9], ['2021-09-30', 1056.6], ['2021-12-31', 808.2], ['2022-03-31', 328.9], ['2022-06-30', 135.3],
    ['2022-09-30', 156.8], ['2022-12-31', 90], ['2023-03-31', 109.3], ['2023-06-30', 80], ['2023-09-30', 64.5],
    ['2023-12-31', 80.7], ['2024-03-31', 67.8], ['2024-06-30', 59.6], ['2024-09-30', 72.4], ['2024-12-31', 45.1],
    ['2025-03-31', 48], ['2025-06-30', 64.5], ['2025-09-30', 57], ['2025-12-31', 51.1], ['2026-03-31', 45.7],
    ['2026-06-30', 46.2], [TODAY, 44.5],
  ])

  it('keeps the axis on the usual values and pins the far ones to the edge', () => {
    const img = draw(SPIKE)
    const ticks = [...img.querySelectorAll('span.text-right')].map((t) => Number(plain(t.textContent).replace(/\./g, '').replace(',', '.')))
    expect(Math.max(...ticks)).toBeLessThan(400)
    const pinned = [...img.querySelectorAll('[data-slot="clipped"]')]
    expect(pinned).toHaveLength(4)
    for (const p of pinned) expect((p as HTMLElement).style.top).toBe('0%')
  })

  it('says the pinned values in the text alternative and on hover', () => {
    const img = draw(SPIKE) as HTMLElement
    const label = plain(img.getAttribute('aria-label'))
    expect(label).toContain('1.925,9 en abr–jun 2019')
    expect(label).toContain('1.056,6 en jul–sep 2021')
    expect(label).toContain('Mínimo: 44,5 hoy.')
    img.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) })
    act(() => { img.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 0 })) })
    expect(plain(img.textContent)).toContain('1.925,9')
  })

  it('leaves an ordinary series alone', () => {
    const img = draw(s([['2025-06-30', 10], ['2025-09-30', 14], ['2025-12-31', 22], ['2026-03-31', 35], ['2026-06-30', 41], [TODAY, 45]]))
    expect(img.querySelectorAll('[data-slot="clipped"]')).toHaveLength(0)
    expect(plain(img.getAttribute('aria-label'))).not.toContain('escala')
  })
})
