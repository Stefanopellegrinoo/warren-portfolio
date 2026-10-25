// odd/tasks/chart-customization.md S2: the selected drawing's Fondo and Configuración, and the style
// they leave remembered for its tool. S8: what the bar did before still does the same.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { factoryStyleFor, type DrawingKind, type DrawingManager } from 'lightweight-charts-drawing'
import { fakeChart } from '@/lib/chart/__tests__/fake-chart'
import { applyRememberedStyles } from '@/lib/chart/remembered-style'
import { getPreferences, setToolStyle } from '@/lib/chart/preferences'
import { TOOL_KINDS } from '@/lib/chart/preferences-schema'
import { DrawingActions } from '../DrawingActions'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const POINTS: Partial<Record<DrawingKind, { time: number; price: number }[]>> = {
  'parallel-channel': [{ time: 100, price: 150 }, { time: 200, price: 180 }, { time: 150, price: 120 }],
  'long-position': [{ time: 100, price: 150 }],
}
const LINE = [{ time: 100, price: 150 }, { time: 200, price: 180 }]

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 50)) })
const byLabel = <T extends HTMLElement = HTMLButtonElement>(label: string) => document.querySelector<T>(`[aria-label="${label}"]`)
const byText = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === text)
const sheet = () => document.querySelector<HTMLElement>('[role="dialog"]')
const headings = () => [...sheet()!.querySelectorAll('h3')].map((h) => h.textContent)
const checkbox = (label: string, within: ParentNode = sheet()!) => [...within.querySelectorAll('label')].find((l) => l.textContent === label)!.querySelector('input')!

let manager: DrawingManager
let off: () => void
let unmount: () => void

async function select(kind: DrawingKind) {
  const id = manager.add({ kind, points: POINTS[kind] ?? LINE } as never)
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<DrawingActions manager={manager} onEditText={() => {}} />) })
  act(() => manager.select([id]))
  unmount = () => act(() => root.unmount())
  return { id, style: () => manager.get(id)!.style }
}
async function openSettings() {
  const gear = byLabel('Configuración')!
  gear.focus()
  act(() => gear.click())
  await flush()
}
async function openFill() {
  act(() => byLabel('Fondo')!.click())
  await flush()
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
  manager = fakeChart().manager
  off = applyRememberedStyles()
})
afterEach(() => {
  unmount?.()
  off()
  TOOL_KINDS.forEach((kind) => setToolStyle(kind, null))
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('Fondo, in the selected drawing bar', () => {
  it('is there on a channel and not on a trend line', async () => {
    await select('trend-line')
    expect(byLabel('Fondo')).toBeNull()
    unmount()

    await select('parallel-channel')
    expect(byLabel('Fondo')).not.toBeNull()
  })

  it("turns a channel's fill off and on, changes its color and its transparency, and its tool remembers them", async () => {
    const { style } = await select('parallel-channel')
    await openFill()

    act(() => checkbox('Fondo visible', document).click())
    expect(style().fillBackground).toBe(false)
    act(() => checkbox('Fondo visible', document).click())
    expect(style().fillBackground).toBe(true)

    act(() => byLabel('Color de fondo naranja')!.click())
    const range = byLabel<HTMLInputElement>('Transparencia')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(range, '40')
      range.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(style()).toMatchObject({ fillBackground: true, backgroundColor: '#ff9800', transparency: 40 })
    expect(getPreferences().toolStyles['parallel-channel']).toEqual({ backgroundColor: '#ff9800', transparency: 40 })
  })

  it("on a position, colors the stop and the target zones", async () => {
    const { style } = await select('long-position')
    await openFill()

    act(() => byLabel('Color del stop violeta')!.click())
    act(() => byLabel('Color del objetivo azul')!.click())

    expect(style()).toMatchObject({ stopColor: '#9c27b0', targetColor: '#2962ff' })
  })
})

describe('Configuración (⚙)', () => {
  it("shows a channel's line, fill, middle line and extensions, and changes them", async () => {
    const { style } = await select('parallel-channel')
    await openSettings()

    expect(sheet()!.textContent).toContain('Canal paralelo')
    expect(headings()).toEqual(['Línea', 'Fondo', 'Extender'])

    act(() => checkbox('Línea del medio').click())
    act(() => checkbox('Extender a la derecha').click())
    act(() => byLabel('Grosor 3')!.click())

    const levels = style().levels!
    expect(levels.find((l) => l.coeff === 0.5)!.visible).toBe(false)
    expect(levels.filter((l) => l.coeff === 0 || l.coeff === 1).map((l) => l.width)).toEqual([3, 3])
    expect(style().extendRight).toBe(true)
  })

  it('shows the levels of a Fibonacci retracement, each with its color and on/off', async () => {
    const { style } = await select('fib-retracement')
    await openSettings()

    expect(headings()).toEqual(['Línea', 'Niveles', 'Fondo', 'Extender'])
    const factory = factoryStyleFor('fib-retracement').levels!
    expect(sheet()!.querySelectorAll('[data-level]')).toHaveLength(factory.length)

    act(() => checkbox('0.618').click())
    const color = byLabel<HTMLInputElement>('Color del nivel 0.618')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(color, '#9c27b0')
      color.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(style().levels!.find((l) => l.coeff === 0.618)).toMatchObject({ visible: false, color: '#9c27b0' })
    // The bands take the level colors: its Fondo has no color of its own.
    expect(byLabel('Color de fondo naranja')).toBeNull()
  })

  it('a trend line has its line and extensions, and no fill', async () => {
    await select('trend-line')
    await openSettings()

    expect(headings()).toEqual(['Línea', 'Extender'])
  })

  it("a change updates the drawing and becomes its tool's style; the next drawing comes out the same", async () => {
    const { id, style } = await select('parallel-channel')
    await openSettings()

    act(() => checkbox('Fondo visible').click())
    act(() => byLabel('Color de línea rojo')!.click())

    expect(style().fillBackground).toBe(false)
    expect(style().levels!.every((l) => l.color === '#f23645')).toBe(true)
    expect(getPreferences().toolStyles['parallel-channel']).toMatchObject({ fillBackground: false, color: '#f23645' })
    const next = manager.get(manager.add({ kind: 'parallel-channel', points: POINTS['parallel-channel']! } as never))!
    expect(next.style).toEqual(manager.get(id)!.style)
  })

  it('Volver al de fábrica resets the drawing and its tool', async () => {
    const { style } = await select('parallel-channel')
    await openSettings()
    act(() => checkbox('Fondo visible').click())
    expect(sheet()!.textContent).toContain('Los próximos canales salen con este estilo.')

    act(() => byText('Volver al de fábrica')!.click())

    expect(style()).toEqual(factoryStyleFor('parallel-channel'))
    expect(getPreferences().toolStyles['parallel-channel']).toBeUndefined()
  })

  it('Listo closes it and gives the focus back to ⚙', async () => {
    await select('parallel-channel')
    await openSettings()

    act(() => [...sheet()!.querySelectorAll('button')].find((b) => b.textContent === 'Listo')!.click())
    await flush()

    expect(sheet()).toBeNull()
    expect(document.activeElement).toBe(byLabel('Configuración'))
  })

  it('closes when its drawing goes away (the Delete key)', async () => {
    const { id } = await select('parallel-channel')
    await openSettings()

    act(() => manager.remove(id))
    await flush()

    expect(sheet()).toBeNull()
  })

  it('Esc closes it and the drawing stays selected', async () => {
    const { id } = await select('parallel-channel')
    await openSettings()

    act(() => { sheet()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    await flush()

    expect(sheet()).toBeNull()
    expect(manager.selection()).toEqual([id])
  })
})

describe('the bar as before (S8)', () => {
  it("its color now colors a channel's lines too, and its tool remembers it", async () => {
    const { style } = await select('parallel-channel')
    act(() => byLabel('Color')!.click())
    await flush()

    act(() => byLabel('Color rojo')!.click())

    expect(style().color).toBe('#f23645')
    expect(style().levels!.every((l) => l.color === '#f23645')).toBe(true)
    expect(getPreferences().toolStyles['parallel-channel']).toMatchObject({ color: '#f23645', textColor: '#f23645' })
  })

  it('a trend line still takes color, thickness and line style, now remembered for the next one', async () => {
    const { style } = await select('trend-line')
    act(() => byLabel('Color')!.click())
    await flush()
    act(() => byLabel('Color rojo')!.click())
    act(() => byLabel('Línea')!.click())
    await flush()
    act(() => byLabel('Grosor 4')!.click())
    act(() => byLabel('Discontinua')!.click())

    expect(style()).toEqual({ ...factoryStyleFor('trend-line'), color: '#f23645', textColor: '#f23645', width: 4, lineStyle: 'dashed' })
    expect(getPreferences().toolStyles['trend-line']).toEqual({ color: '#f23645', textColor: '#f23645', width: 4, lineStyle: 'dashed' })
  })

  it('lock, delete and undo keep working next to the new buttons', async () => {
    const { id } = await select('parallel-channel')
    act(() => byLabel('Bloquear')!.click())
    expect(manager.get(id)!.locked).toBe(true)

    const before = manager.get(id)
    act(() => byLabel('Borrar dibujo')!.click())
    expect(manager.drawings()).toEqual([])
    act(() => byText('Deshacer')!.click())
    expect(manager.get(id)).toEqual(before)
  })
})
