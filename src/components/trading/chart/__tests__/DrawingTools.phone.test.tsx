import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { fakeChart } from '@/lib/chart/__tests__/fake-chart'
import { DrawingTools } from '../DrawingTools'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { document.body.innerHTML = '' })

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
// The phone controls, in the bar the page gives them; the desktop strip is the toolbar hidden by CSS below 820px.
const phone = () => document.querySelector<HTMLElement>('[role="group"][aria-label="Dibujos"]')!
const inPhone = (name: string) => [...phone().querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? b.textContent) === name)
const alertMenu = () => document.querySelector<HTMLElement>('[aria-label="Alertas"][role="dialog"]')
const menuItem = (text: string) => [...(alertMenu()?.querySelectorAll('button') ?? [])].find(b => b.textContent?.startsWith(text))
const option = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Herramientas"] button')].find(b => b.textContent?.trim() === name)

const ALERTS = [
  { id: 'a1', ticker: 'FXI', name: 'n', status: 'active', color: '#f23645', source: 'price', operator: 'crosses_above', target: 'value', value: 32.5, timeframe: null, periods: null },
  { id: 'a2', ticker: 'FXI', name: 'n', status: 'unavailable', color: null, source: 'price', operator: 'crosses', target: 'ema50.ema50', value: null, timeframe: '1d', periods: { ema50: 50 } },
  { id: 'a3', ticker: 'FXI', name: 'n', status: 'triggered', color: null, source: 'rsi.rsi', operator: 'crosses_above', target: 'value', value: 70, timeframe: '1h', periods: { rsi: 14 } },
] as const

async function render({ alertMode = false, alerts = [] as readonly unknown[] } = {}) {
  const { manager } = fakeChart()
  const onAlertMode = vi.fn()
  const onNewAlert = vi.fn()
  const onOpenAlert = vi.fn()
  const el = document.createElement('div')
  const bar = document.createElement('div')
  document.body.append(el, bar)
  const root = createRoot(el)
  const draw = (mode: boolean) => root.render(<DrawingTools manager={manager} alertMode={mode} onAlertMode={onAlertMode} phoneBar={bar} symbol="FXI" alerts={alerts as never} onNewAlert={onNewAlert} onOpenAlert={onOpenAlert} />)
  await act(async () => { draw(alertMode) })
  const openTools = async () => { act(() => inPhone('Dibujar')!.click()); await flush() }
  return { manager, bar, onAlertMode, onNewAlert, onOpenAlert, openTools, rerender: (mode: boolean) => act(() => draw(mode)), unmount: () => act(() => root.unmount()) }
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

  // odd/tasks/chart-pro-redesign.md S6: the same five groups as the computer's rail.
  it('Dibujar heads its tools with the five groups of the rail', async () => {
    const { openTools, unmount } = await render()

    await openTools()

    expect([...document.querySelectorAll('[aria-label="Herramientas"] section')].map(s => s.getAttribute('aria-label'))).toEqual(['Líneas', 'Canales y Fibonacci', 'Formas y texto', 'Medición', 'Posiciones'])
    expect([...document.querySelectorAll('[aria-label="Herramientas"] h3')].map(h => h.textContent)).toEqual(['Líneas', 'Canales y Fibonacci', 'Formas y texto', 'Medición', 'Posiciones'])
    expect([...document.querySelectorAll('[aria-label="Posiciones"] button[aria-pressed]')].map(b => b.getAttribute('aria-label'))).toEqual(['Agregar Posición larga a favoritos', 'Agregar Posición corta a favoritos'])
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

  // odd/tasks/chart-customization.md S6: Alerta opens a menu; its first entry is today's quick alert.
  it('Alerta, then "Tocar el precio en el gráfico", arms the price alert and Cancelar leaves it', async () => {
    const { onAlertMode, rerender, unmount } = await render()

    act(() => inPhone('Alerta')!.click())
    await flush()
    expect(onAlertMode).not.toHaveBeenCalled()
    act(() => menuItem('Tocar el precio en el gráfico')!.click())
    await flush()
    expect(onAlertMode).toHaveBeenCalledWith(true)
    expect(alertMenu()).toBeNull()

    rerender(true)
    expect(phone().textContent).toContain('Tocá el gráfico en el precio de la alerta')
    act(() => inPhone('Cancelar')!.click())
    expect(onAlertMode).toHaveBeenLastCalledWith(false)
    unmount()
  })

  it('goes in the bar the page gives it', async () => {
    const { bar, unmount } = await render()
    expect(bar.contains(phone())).toBe(true)
    unmount()
  })

  // odd/tasks/grafico-espacio.md S4: the armed state takes the whole bar, as the row did.
  it('armed, what to do covers the whole bar', async () => {
    const { openTools, unmount } = await render()
    await openTools()
    act(() => option('Rectángulo')!.click())
    expect(phone().querySelector('[role="status"]')!.parentElement!.className).toMatch(/\babsolute\b.*\binset-x-0\b/)
    unmount()
  })

  it('hidden drawings show on the Dibujar button', async () => {
    const { manager, unmount } = await render()
    act(() => manager.setDrawingsVisible(false))
    expect(inPhone('Dibujar (dibujos ocultos)')).toBeDefined()
    act(() => manager.setDrawingsVisible(true))
    expect(inPhone('Dibujar')).toBeDefined()
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

// odd/tasks/chart-customization.md S6: the alert menu — the quick alert, a new one in the sheet, and this ticker's alerts.
describe('the alert menu on a phone', () => {
  it('offers the quick alert, a new alert, and says when this ticker has none', async () => {
    const { unmount } = await render()

    act(() => inPhone('Alerta')!.click())
    await flush()

    expect(menuItem('Tocar el precio en el gráfico')).toBeDefined()
    expect(menuItem('Nueva alerta…')).toBeDefined()
    expect(alertMenu()!.textContent).toContain('No hay alertas en FXI')
    unmount()
  })

  it('"Nueva alerta…" opens the sheet', async () => {
    const { onNewAlert, onAlertMode, unmount } = await render()
    act(() => inPhone('Alerta')!.click())
    await flush()

    act(() => menuItem('Nueva alerta…')!.click())
    await flush()

    expect(onNewAlert).toHaveBeenCalledOnce()
    expect(onAlertMode).not.toHaveBeenCalledWith(true)
    expect(alertMenu()).toBeNull()
    unmount()
  })

  it("lists this ticker's alerts in words, with their state, each opening its sheet", async () => {
    const { onOpenAlert, unmount } = await render({ alerts: ALERTS })
    act(() => inPhone('Alerta')!.click())
    await flush()

    const items = [...alertMenu()!.querySelectorAll('[data-alert-item]')].map((b) => b.textContent)
    expect(items).toEqual(['Supera 32,50', 'Precio cruza EMA 50 (1D) · cualquieraNo se puede revisar', 'RSI 14 cruza 70 (1h) · para arribaDisparada'])
    act(() => (alertMenu()!.querySelectorAll<HTMLButtonElement>('[data-alert-item]')[1]).click())
    await flush()

    expect(onOpenAlert).toHaveBeenCalledWith('a2')
    expect(alertMenu()).toBeNull()
    unmount()
  })

  it('each alert shows its color', async () => {
    const { unmount } = await render({ alerts: ALERTS })
    act(() => inPhone('Alerta')!.click())
    await flush()

    const dot = alertMenu()!.querySelector<HTMLElement>('[data-alert-item] [data-alert-color]')!
    expect(dot.style.background).toBe('rgb(242, 54, 69)')
    unmount()
  })
})
