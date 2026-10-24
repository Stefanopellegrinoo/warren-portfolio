import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { toast } from 'sonner'
import type { Drawing } from 'lightweight-charts-drawing'
import { fakeChart } from '@/lib/chart/__tests__/fake-chart'
import { DrawingActions } from '../DrawingActions'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('sonner', () => ({ toast: vi.fn() }))

afterEach(() => { vi.clearAllMocks(); document.body.innerHTML = '' })

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const bar = () => document.querySelector('[role="toolbar"][aria-label="Dibujo seleccionado"]')
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

  it('deletes it with a tap and offers to undo', async () => {
    const { manager, id, select, unmount } = await render()
    select()
    const before = manager.get(id)

    act(() => byLabel('Borrar dibujo')!.click())

    expect(manager.drawings()).toEqual([])
    expect(bar()).toBeNull()
    expect(toast).toHaveBeenCalledWith('Dibujo borrado', expect.objectContaining({ action: expect.objectContaining({ label: 'Deshacer' }) }))
    const { action } = vi.mocked(toast).mock.calls[0][1] as unknown as { action: { onClick: () => void } }
    act(() => action.onClick())
    expect(manager.get(id)).toEqual(before)
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
