import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { toast } from 'sonner'
import type { Drawing } from 'lightweight-charts-drawing'
import { fakeChart } from '@/lib/chart/__tests__/fake-chart'
import { DrawingActions } from '../DrawingActions'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('sonner', () => ({ toast: vi.fn() }))

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); document.body.innerHTML = '' })

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const bar = () => document.querySelector('[role="toolbar"][aria-label="Dibujo seleccionado"]')
const undoBar = () => document.querySelector('[role="status"][aria-label="Dibujo borrado"]')
const byText = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent === text)
const byLabel = (label: string) => document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)

async function render(kind: 'trend-line' | 'text' = 'trend-line') {
  const { manager } = fakeChart()
  const id = manager.add({ kind, points: kind === 'text' ? [{ time: 100, price: 150 }] : [{ time: 100, price: 150 }, { time: 200, price: 180 }], ...(kind === 'text' ? { text: 'Soporte' } : {}) } as never)
  const onEditText = vi.fn()
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<DrawingActions manager={manager} onEditText={onEditText} />) })
  const select = () => act(() => manager.select([id]))
  return { manager, id, onEditText, select, unmount: () => act(() => root.unmount()) }
}

describe('the selected drawing on a phone (S3)', () => {
  it('shows its actions only while a drawing is selected', async () => {
    const { manager, select, unmount } = await render()
    expect(bar()).toBeNull()

    select()
    expect(bar()).not.toBeNull()

    act(() => byLabel('Listo')!.click())
    expect(manager.selection()).toEqual([])
    expect(bar()).toBeNull()
    unmount()
  })

  it('deletes it with a tap and offers to undo in its own bar, where the finger is', async () => {
    const { manager, id, select, unmount } = await render()
    select()
    const before = manager.get(id)

    act(() => byLabel('Borrar dibujo')!.click())

    expect(manager.drawings()).toEqual([])
    expect(bar()).toBeNull()
    expect(toast).not.toHaveBeenCalled()
    expect(undoBar()!.textContent).toContain('Dibujo borrado')
    act(() => byText('Deshacer')!.click())
    expect(manager.get(id)).toEqual(before)
    expect(undoBar()).toBeNull()
    unmount()
  })

  it('the undo offer goes away after five seconds, or when another drawing is selected', async () => {
    vi.useFakeTimers()
    const { manager, select, unmount } = await render()
    select()
    act(() => byLabel('Borrar dibujo')!.click())

    act(() => { vi.advanceTimersByTime(4900) })
    expect(undoBar()).not.toBeNull()
    act(() => { vi.advanceTimersByTime(100) })
    expect(undoBar()).toBeNull()

    const other = manager.add({ kind: 'horizontal-line', points: [{ time: 100, price: 100 }] } as never)
    act(() => manager.select([other]))
    act(() => byLabel('Borrar dibujo')!.click())
    act(() => manager.select([manager.add({ kind: 'horizontal-line', points: [{ time: 100, price: 50 }] } as never)]))
    expect(undoBar()).toBeNull()
    vi.useRealTimers()
    unmount()
  })

  it('changes its color, thickness and line style', async () => {
    const { manager, id, select, unmount } = await render()
    select()

    act(() => byLabel('Color')!.click())
    await flush()
    act(() => byLabel('Color rojo')!.click())
    act(() => byLabel('Línea')!.click())
    await flush()
    act(() => byLabel('Grosor 4')!.click())
    act(() => byLabel('Discontinua')!.click())

    expect(manager.get(id)!.style).toMatchObject({ color: '#f23645', width: 4, lineStyle: 'dashed' })
    unmount()
  })

  it('locks it so a finger cannot move it, and unlocks it', async () => {
    const { manager, id, select, unmount } = await render()
    select()

    act(() => byLabel('Bloquear')!.click())
    expect(manager.get(id)!.locked).toBe(true)
    act(() => byLabel('Desbloquear')!.click())
    expect(manager.get(id)!.locked).toBe(false)
    unmount()
  })

  it('a text drawing opens its text editor without a double tap', async () => {
    const { manager, id, onEditText, select, unmount } = await render('text')
    select()

    act(() => byLabel('Editar texto')!.click())

    expect(onEditText).toHaveBeenCalledWith(manager.get(id) as Drawing)
    unmount()
  })

  it('a line has no text editor button', async () => {
    const { select, unmount } = await render()
    select()

    expect(byLabel('Editar texto')).toBeNull()
    unmount()
  })
})

// odd/tasks/chart-customization.md S8 (L7): at 320px the bar's seven actions are wider than the chart and
// scrolled inside the bar, hiding "Listo". jsdom lays nothing out: these pin the classes that do it, and the
// probe measures it in Chromium at 320, 375 and 390.
describe('the selected drawing bar on a 320px phone (S8)', () => {
  // The bar as it was: one row, centered over the chart, no wider than the chart.
  const BEFORE = 'absolute bottom-3 left-1/2 z-20 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded border border-line bg-surface p-1 shadow-[var(--shadow-pop)]'

  it('wraps to a second row instead of scrolling, as wide as its actions up to the chart; the same one row when they fit', async () => {
    const { select, unmount } = await render()
    select()
    const classes = bar()!.className.split(' ')

    // Every class of the one-row bar stays, none behind a breakpoint: where the actions fit (375 and up,
    // the computer) nothing moves. w-max: its own width, not the half of the chart left of its center.
    expect(classes).toEqual(expect.arrayContaining(BEFORE.split(' ')))
    expect(classes.filter((c) => !BEFORE.split(' ').includes(c)).sort()).toEqual(['flex-wrap', 'justify-center', 'w-max'])
    // Every action is the bar's own 44px button: none is hidden or moved elsewhere.
    expect([...bar()!.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Color', 'Línea', 'Configuración', 'Bloquear', 'Borrar dibujo', 'Listo'])
    bar()!.querySelectorAll('button').forEach((b) => expect(b.className).toContain('max-[819px]:h-11'))
    unmount()
  })

  it('the undo offer keeps its look', async () => {
    const { select, unmount } = await render()
    select()
    act(() => byLabel('Borrar dibujo')!.click())

    expect(undoBar()!.className).not.toContain('flex-wrap')
    expect(undoBar()!.className).not.toContain('w-max')
    unmount()
  })
})
