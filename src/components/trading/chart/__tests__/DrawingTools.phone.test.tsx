import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { fakeChart } from '@/lib/chart/__tests__/fake-chart'
import { DrawingTools } from '../DrawingTools'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { document.body.innerHTML = '' })

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
// The phone bar: the desktop strip is the other toolbar, hidden by CSS below 820px.
const phone = () => document.querySelector<HTMLElement>('[role="toolbar"][aria-label="Dibujos"]')!
const inPhone = (name: string) => [...phone().querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? b.textContent) === name)
const option = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Herramientas"] button')].find(b => b.textContent?.trim() === name)

async function render({ alertMode = false } = {}) {
  const { manager } = fakeChart()
  const onAlertMode = vi.fn()
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  const draw = (mode: boolean) => root.render(<DrawingTools manager={manager} alertMode={mode} onAlertMode={onAlertMode} />)
  await act(async () => { draw(alertMode) })
  const openTools = async () => { act(() => inPhone('Dibujar')!.click()); await flush() }
  return { manager, onAlertMode, openTools, rerender: (mode: boolean) => act(() => draw(mode)), unmount: () => act(() => root.unmount()) }
}

describe('drawing tools on a phone (S5)', () => {
  it('Dibujar lists every tool by its name', async () => {
    const { openTools, unmount } = await render()

    await openTools()

    for (const name of ['Línea de tendencia', 'Línea horizontal', 'Canal paralelo', 'Retroceso de Fibonacci', 'Rectángulo', 'Pincel', 'Texto', 'Rango de precio', 'Posición larga', 'Posición corta']) {
      expect(option(name), name).toBeDefined()
    }
    unmount()
  })

  it('a chosen tool is armed and the bar says what to do, with Cancelar', async () => {
    const { manager, openTools, unmount } = await render()
    await openTools()

    act(() => option('Línea de tendencia')!.click())
    await flush()

    expect(manager.tool()).toBe('trend-line')
    expect(phone().textContent).toContain('Línea de tendencia')
    expect(phone().textContent).toContain('Tocá dos puntos o arrastrá')
    expect(document.querySelector('[aria-label="Herramientas"]')).toBeNull()

    act(() => inPhone('Cancelar')!.click())
    expect(manager.tool()).toBeNull()
    expect(phone().textContent).not.toContain('Tocá dos puntos')
    unmount()
  })

  it('a one-point tool asks for one tap', async () => {
    const { openTools, unmount } = await render()
    await openTools()

    act(() => option('Línea horizontal')!.click())

    expect(phone().textContent).toContain('Tocá en el gráfico')
    unmount()
  })

  it('Alerta arms the price alert and Cancelar leaves it', async () => {
    const { onAlertMode, rerender, unmount } = await render()

    act(() => inPhone('Alerta')!.click())
    expect(onAlertMode).toHaveBeenCalledWith(true)

    rerender(true)
    expect(phone().textContent).toContain('Tocá el gráfico en el precio de la alerta')
    act(() => inPhone('Cancelar')!.click())
    expect(onAlertMode).toHaveBeenLastCalledWith(false)
    unmount()
  })

  it('the magnet, hiding the drawings and deleting them all are in the list', async () => {
    const { manager, openTools, unmount } = await render()
    manager.add({ kind: 'horizontal-line', points: [{ time: 100, price: 150 }] } as never)
    const magnet = vi.spyOn(manager, 'setMagnet')
    await openTools()

    act(() => option('Imán')!.click())
    expect(magnet).toHaveBeenCalledWith('weak')

    act(() => option('Ocultar dibujos')!.click())
    expect(manager.drawingsVisible()).toBe(false)

    act(() => option('Borrar todos')!.click())
    await flush()
    expect(document.body.textContent).toContain('¿Borrar todos los dibujos de este activo?')
    act(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'Sí, borrar')!.click())
    expect(manager.drawings()).toEqual([])
    unmount()
  })
})
