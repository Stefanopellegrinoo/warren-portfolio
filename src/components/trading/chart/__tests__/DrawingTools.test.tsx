import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import type { DrawingManager } from 'lightweight-charts-drawing'
import { DrawingTools } from '../DrawingTools'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

const QUESTION = '¿Borrar todos los dibujos de este activo?'
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.includes(text))
const strip = () => document.querySelector<HTMLElement>('[role="toolbar"][aria-label="Herramientas de dibujo"]')!
const more = () => strip().querySelector<HTMLButtonElement>('button[aria-label="Más"]')!
const inMore = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Más"][role="dialog"] button')].find(b => b.textContent === text)
const trash = () => inMore('Borrar todos los dibujos')!
// "Borrar todos los dibujos" is in the strip's Más menu (S8: the strip fits a 1280×800 window).
const openMore = async () => { act(() => more().click()); await flush() }

async function render(drawings: number) {
  const manager = {
    on: vi.fn(() => () => {}),
    drawings: vi.fn(() => Array.from({ length: drawings }, (_, i) => ({ id: String(i) }))),
    clear: vi.fn(),
    setTool: vi.fn(),
    setMagnet: vi.fn(),
    setDrawingsVisible: vi.fn(),
  }
  const confirm = vi.spyOn(window, 'confirm')
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<DrawingTools manager={manager as unknown as DrawingManager} alertMode={false} onAlertMode={() => {}} />) })
  return { manager, confirm, unmount: () => act(() => root.unmount()) }
}

describe('DrawingTools — "Borrar todos los dibujos" asks inside the app', () => {
  it('asks with the same question and clears only on "Sí, borrar"', async () => {
    const { manager, confirm, unmount } = await render(2)

    await openMore()
    act(() => trash().click())
    await flush()

    expect(document.body.textContent).toContain(QUESTION)
    expect(confirm).not.toHaveBeenCalled()
    expect(manager.clear).not.toHaveBeenCalled()

    act(() => button('Sí, borrar')!.click())
    await flush()

    expect(manager.clear).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).not.toContain(QUESTION)
    unmount()
  })

  it('Cancelar keeps the drawings', async () => {
    const { manager, unmount } = await render(2)

    await openMore()
    act(() => trash().click())
    await flush()
    act(() => button('Cancelar')!.click())
    await flush()

    expect(manager.clear).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain(QUESTION)
    unmount()
  })

  it('with no drawings it does not ask', async () => {
    const { manager, confirm, unmount } = await render(0)

    await openMore()
    act(() => trash().click())
    await flush()

    expect(document.body.textContent).not.toContain(QUESTION)
    expect(confirm).not.toHaveBeenCalled()
    expect(manager.clear).not.toHaveBeenCalled()
    unmount()
  })
})

// odd/tasks/chart-customization.md S6: on a computer the strip's bell opens the same menu; while the quick alert waits, it cancels it.
describe('DrawingTools — the alert menu on a computer', () => {
  async function renderAlerts(alertMode: boolean) {
    const manager = { on: vi.fn(() => () => {}), drawings: vi.fn(() => []), setTool: vi.fn(), setMagnet: vi.fn(), setDrawingsVisible: vi.fn() }
    const onAlertMode = vi.fn()
    const onNewAlert = vi.fn()
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => { root.render(<DrawingTools manager={manager as unknown as DrawingManager} alertMode={alertMode} onAlertMode={onAlertMode} symbol="FXI" alerts={[]} onNewAlert={onNewAlert} onOpenAlert={() => {}} />) })
    return { manager, onAlertMode, onNewAlert, unmount: () => act(() => root.unmount()) }
  }
  const bell = () => document.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Alertas"]')!
  const item = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Alertas"][role="dialog"] button')].find(b => b.textContent?.startsWith(text))

  it('the bell opens the menu; "Tocar el precio en el gráfico" arms the quick alert with no drawing tool', async () => {
    const { manager, onAlertMode, unmount } = await renderAlerts(false)

    act(() => bell().click())
    await flush()
    act(() => item('Tocar el precio en el gráfico')!.click())

    expect(manager.setTool).toHaveBeenCalledWith(null)
    expect(onAlertMode).toHaveBeenCalledWith(true)
    unmount()
  })

  it('"Nueva alerta…" asks for the sheet', async () => {
    const { onNewAlert, unmount } = await renderAlerts(false)

    act(() => bell().click())
    await flush()
    act(() => item('Nueva alerta…')!.click())

    expect(onNewAlert).toHaveBeenCalledOnce()
    unmount()
  })

  it('while the quick alert waits for its tap, the bell cancels it', async () => {
    const { onAlertMode, unmount } = await renderAlerts(true)

    expect(bell().getAttribute('aria-pressed')).toBe('true')
    act(() => bell().click())
    await flush()

    expect(onAlertMode).toHaveBeenCalledWith(false)
    expect(item('Nueva alerta…')).toBeUndefined()
    unmount()
  })
})

// odd/tasks/chart-customization.md S8 (L8): the favorites' star made the strip 783px, taller than the 751px it
// gets in a 1280×800 window, so "Borrar todos" needed a scroll. Elegir favoritos and Borrar todos, the two
// controls used once in a while, share one Más at the strip's end: the strip is back to its 746px.
describe('DrawingTools — the strip on a computer fits a 1280×800 window (S8)', () => {
  const TOOLS = [
    'Línea de tendencia', 'Rayo', 'Línea extendida', 'Línea horizontal', 'Rayo horizontal', 'Línea vertical',
    'Canal paralelo', 'Retroceso de Fibonacci', 'Extensión de Fibonacci',
    'Rectángulo', 'Pincel', 'Texto',
    'Rango de precio', 'Rango de fecha y precio', 'Posición larga', 'Posición corta',
  ]

  it('keeps every control in 21 buttons and 6 dividers, 746px as before the favorites', async () => {
    const { unmount } = await render(1)
    const labels = [...strip().querySelectorAll('button')].map(b => b.getAttribute('aria-label'))
    const dividers = strip().querySelectorAll('span.bg-line').length

    expect(labels).toEqual(['Cursor', ...TOOLS, 'Alertas', 'Imán', 'Ocultar dibujos', 'Más'])
    expect(dividers).toBe(6)
    // 32px buttons, 1px dividers, 2px between them, 8px above and below; jsdom lays nothing out.
    expect(labels.length * 32 + dividers + (labels.length + dividers - 1) * 2 + 16).toBe(746)
    unmount()
  })

  it('Más offers Elegir favoritos, the list of every tool with its star, and Borrar todos los dibujos', async () => {
    const { unmount } = await render(1)
    await openMore()

    expect([...document.querySelectorAll('[aria-label="Más"][role="dialog"] button')].map(b => b.textContent)).toEqual(['Elegir favoritos', 'Borrar todos los dibujos'])
    act(() => inMore('Elegir favoritos')!.click())
    await flush()

    const list = document.querySelector('[aria-label="Elegir favoritos"][role="dialog"]')!
    expect(list.querySelector('input[role="switch"]')).not.toBeNull()
    TOOLS.forEach(t => expect(list.querySelector(`button[aria-label="Agregar ${t} a favoritos"]`)).not.toBeNull())
    unmount()
  })

  it('with no drawings, Borrar todos los dibujos is there but off', async () => {
    const { unmount } = await render(0)
    await openMore()

    expect(trash().disabled).toBe(true)
    unmount()
  })
})
