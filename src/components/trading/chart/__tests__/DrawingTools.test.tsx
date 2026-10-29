import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import type { DrawingManager } from 'lightweight-charts-drawing'
import { fakeChart } from '@/lib/chart/__tests__/fake-chart'
import { memoryStorage } from '@/lib/chart/__tests__/memory-storage'
import { getPreferences, setFavorite } from '@/lib/chart/preferences'
import { TOOL_KINDS } from '@/lib/chart/preferences-schema'
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

// odd/tasks/chart-customization.md S8 (L8): the strip had to fit the 751px a 1280×800 window gives it, and
// Elegir favoritos and Borrar todos share one Más at its end. odd/tasks/chart-pro-redesign.md S6: the 16 tools
// now sit behind one button per group, so the strip went from 21 buttons, 6 dividers and 746px to 10, 2 and 360px.
describe('DrawingTools — the strip on a computer fits a 1280×800 window (S8)', () => {
  const TOOLS = [
    'Línea de tendencia', 'Rayo', 'Línea extendida', 'Línea horizontal', 'Rayo horizontal', 'Línea vertical',
    'Canal paralelo', 'Retroceso de Fibonacci', 'Extensión de Fibonacci',
    'Rectángulo', 'Pincel', 'Texto',
    'Rango de precio', 'Rango de fecha y precio', 'Posición larga', 'Posición corta',
  ]

  it('keeps every control in 10 buttons and 2 dividers, 360px', async () => {
    const { unmount } = await render(1)
    const labels = [...strip().querySelectorAll('button')].map(b => b.getAttribute('aria-label'))
    const dividers = strip().querySelectorAll('span.bg-line').length

    expect(labels).toEqual(['Cursor', 'Líneas', 'Canales y Fibonacci', 'Formas y texto', 'Medición', 'Posiciones', 'Alertas', 'Imán', 'Ocultar dibujos', 'Más'])
    expect(dividers).toBe(2)
    // 32px buttons, 1px dividers, 2px between them, 8px above and below; jsdom lays nothing out.
    expect(labels.length * 32 + dividers + (labels.length + dividers - 1) * 2 + 16).toBe(360)
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

describe('DrawingTools — Mi cartera', () => {
  it('offers no alerts: they watch a ticker\'s price', async () => {
    const manager = { on: vi.fn(() => () => {}), drawings: vi.fn(() => []), setTool: vi.fn(), setMagnet: vi.fn(), setDrawingsVisible: vi.fn() }
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => { root.render(<DrawingTools manager={manager as unknown as DrawingManager} alertMode={false} onAlertMode={() => {}} symbol="__portfolio__" alerts={[]} />) })

    expect(document.querySelector('[role="toolbar"] button[aria-label="Alertas"]')).toBeNull()
    expect(document.querySelector('[role="toolbar"] button[aria-label="Imán"]')).not.toBeNull()
    act(() => root.unmount())
  })
})

// odd/tasks/chart-pro-redesign.md S6: the rail in five groups. Each group is one button with the icon of the
// tool last chosen from it; it opens, to its right, the group's tools by name with their stars (S3: all 16 kept).
describe('DrawingTools — the rail in five groups (chart-pro-redesign S6)', () => {
  const GROUPS: Record<string, string[]> = {
    'Líneas': ['Línea de tendencia', 'Rayo', 'Línea extendida', 'Línea horizontal', 'Rayo horizontal', 'Línea vertical'],
    'Canales y Fibonacci': ['Canal paralelo', 'Retroceso de Fibonacci', 'Extensión de Fibonacci'],
    'Formas y texto': ['Rectángulo', 'Pincel', 'Texto'],
    'Medición': ['Rango de precio', 'Rango de fecha y precio'],
    'Posiciones': ['Posición larga', 'Posición corta'],
  }

  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'PATCH'
      ? new Response(null, { status: 204 })
      : new Response(JSON.stringify({ userId: 'u1', preferences: { favorites: {}, toolStyles: {}, indicatorSettings: {} } }))))
  })
  afterEach(() => {
    TOOL_KINDS.forEach(kind => setFavorite(kind, false))
    vi.unstubAllGlobals()
  })

  async function renderRail() {
    const { manager } = fakeChart()
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => { root.render(<DrawingTools manager={manager} alertMode={false} onAlertMode={() => {}} symbol="FXI" alerts={[]} />) })
    return { manager, unmount: () => act(() => root.unmount()) }
  }
  const group = (name: string) => strip().querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!
  const flyout = (name: string) => document.querySelector<HTMLElement>(`[role="menu"][aria-label="${name}"]`)
  const open = async (name: string) => {
    const trigger = group(name)
    await act(async () => {
      trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))
      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      trigger.click()
      await new Promise((r) => setTimeout(r, 50))
    })
  }
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)) })
  const names = (menu: HTMLElement) => [...menu.querySelectorAll('[role="menuitem"]')].map(i => i.textContent?.trim())
  const pick = (menu: HTMLElement, name: string) => [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(i => i.textContent?.trim() === name)!
  const key = (k: string) => act(() => { (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })) })

  it('each group shows its first tool until one is chosen, and says it opens a menu', async () => {
    const { unmount } = await renderRail()

    for (const [name, tools] of Object.entries(GROUPS)) {
      expect(group(name).title).toBe(`${name}: ${tools[0]}`)
      expect(group(name).getAttribute('aria-haspopup')).toBe('menu')
      expect(group(name).getAttribute('aria-expanded')).toBe('false')
    }
    unmount()
  })

  it('each flyout opens outside the rail, names every tool of its group and gives each its star', async () => {
    const { unmount } = await renderRail()

    for (const [name, tools] of Object.entries(GROUPS)) {
      await open(name)
      const menu = flyout(name)!
      expect(group(name).getAttribute('aria-expanded')).toBe('true')
      // In a portal: the rail scrolls (overflow-y-auto) and would clip it.
      expect(strip().contains(menu)).toBe(false)
      expect(names(menu)).toEqual(tools)
      expect([...menu.querySelectorAll('[role="menuitemcheckbox"]')].map(s => s.getAttribute('aria-label'))).toEqual(tools.map(t => `${t} en favoritos`))
      key('Escape')
      await settle()
    }
    unmount()
  })

  it('choosing a tool arms it, closes the flyout and lights its group', async () => {
    const { manager, unmount } = await renderRail()
    await open('Canales y Fibonacci')

    act(() => pick(flyout('Canales y Fibonacci')!, 'Retroceso de Fibonacci').click())
    await settle()

    expect(manager.tool()).toBe('fib-retracement')
    expect(flyout('Canales y Fibonacci')).toBeNull()
    expect(group('Canales y Fibonacci').getAttribute('aria-pressed')).toBe('true')
    expect(group('Líneas').getAttribute('aria-pressed')).toBe('false')
    expect(group('Canales y Fibonacci').title).toBe('Canales y Fibonacci: Retroceso de Fibonacci')
    unmount()
  })

  it('remembers the last tool of each group on this device', async () => {
    const first = await renderRail()
    await open('Medición')
    act(() => pick(flyout('Medición')!, 'Rango de fecha y precio').click())
    await settle()
    first.unmount()

    const { unmount } = await renderRail()
    expect(group('Medición').title).toBe('Medición: Rango de fecha y precio')
    expect(group('Líneas').title).toBe('Líneas: Línea de tendencia')
    unmount()
  })

  it('a saved tool that is not in its group shows the first one; without storage it is kept for this visit', async () => {
    localStorage.setItem('warren:chart-draw-groups', JSON.stringify({ 'Líneas': 'rectangle' }))
    const saved = await renderRail()
    expect(group('Líneas').title).toBe('Líneas: Línea de tendencia')
    saved.unmount()

    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
    const { unmount } = await renderRail()
    await open('Posiciones')
    act(() => pick(flyout('Posiciones')!, 'Posición corta').click())
    await settle()
    expect(group('Posiciones').title).toBe('Posiciones: Posición corta')
    unmount()
  })

  it('Esc and a click outside close the flyout', async () => {
    const { unmount } = await renderRail()

    await open('Formas y texto')
    key('Escape')
    await settle()
    expect(flyout('Formas y texto')).toBeNull()

    await open('Formas y texto')
    await act(async () => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      document.body.click()
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(flyout('Formas y texto')).toBeNull()
    unmount()
  })

  it('the arrow keys move through the flyout', async () => {
    const { unmount } = await renderRail()
    await open('Formas y texto')
    const menu = flyout('Formas y texto')!
    const focused = () => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim()

    // Each row is the tool, then its star.
    expect(focused()).toBe('Rectángulo')
    key('ArrowDown')
    expect(focused()).toBe('Rectángulo en favoritos')
    key('ArrowDown')
    expect(focused()).toBe('Pincel')
    key('ArrowUp')
    expect(focused()).toBe('Rectángulo en favoritos')
    expect(menu.contains(document.activeElement)).toBe(true)
    unmount()
  })

  it('the star in a flyout makes the tool a favorite in the account without arming it', async () => {
    const { manager, unmount } = await renderRail()
    await open('Líneas')

    const star = flyout('Líneas')!.querySelector<HTMLElement>('[aria-label="Rayo en favoritos"]')!
    act(() => star.click())
    await settle()

    expect(getPreferences().favorites.ray).toBe(true)
    expect(star.getAttribute('aria-checked')).toBe('true')
    expect(manager.tool()).toBeNull()
    expect(flyout('Líneas')).not.toBeNull()
    unmount()
  })

  // As before the groups: the cursor drops the armed tool, the magnet and the eye toggle.
  it('the cursor, the magnet and the eye work as before', async () => {
    const { manager, unmount } = await renderRail()
    const magnet = vi.spyOn(manager, 'setMagnet')
    await open('Líneas')
    act(() => pick(flyout('Líneas')!, 'Rayo').click())
    await settle()

    act(() => group('Cursor').click())
    expect(manager.tool()).toBeNull()
    expect(group('Líneas').getAttribute('aria-pressed')).toBe('false')
    expect(group('Cursor').getAttribute('aria-pressed')).toBe('true')

    act(() => group('Imán').click())
    expect(magnet).toHaveBeenCalledWith('weak')
    expect(group('Imán activado').getAttribute('aria-pressed')).toBe('true')

    act(() => group('Ocultar dibujos').click())
    expect(manager.drawingsVisible()).toBe(false)
    expect(group('Mostrar dibujos')).not.toBeNull()
    unmount()
  })
})
