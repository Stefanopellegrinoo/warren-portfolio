import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// Node 25 ships a stub localStorage without methods; the shell keeps this device's choices in a real one.
const stored = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, v),
    removeItem: (k: string) => void stored.delete(k),
    clear: () => stored.clear(),
  },
})

const nav = vi.hoisted(() => ({ path: '/activo/MELI' }))
vi.mock('next/navigation', () => ({
  usePathname: () => nav.path,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

import ActivoLayout from '../layout'
import TradingLayout from '@/app/trading/layout'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.menu
  document.body.innerHTML = ''
})

const ICONS = 'min-[820px]:[[data-menu=icons]_&]:'

function mount(Layout: typeof ActivoLayout, path: string) {
  nav.path = path
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  act(() => root.render(<Layout><p>contenido</p></Layout>))
  // » / « is the only menu toggle inside the menu; the phone bar's button sits outside it.
  const toggle = () => el.querySelector<HTMLButtonElement>('#sidebar button[aria-controls="sidebar"]')
  return { el, toggle, unmount: () => act(() => root.unmount()) }
}

// odd/tasks/asset-page.md L24: the asset page gets Gráficos' icon-only menu, so its tables have room.
describe('/activo layout — the app menu', () => {
  it('shows only the icons from 820 px, each named by a tooltip, with » to pin it open', () => {
    const { el, toggle } = mount(ActivoLayout, '/activo/MELI')
    expect(el.firstElementChild!.classList.contains(`${ICONS}grid-cols-[64px_minmax(0,1fr)]`)).toBe(true)
    const resumen = el.querySelector<HTMLElement>('nav a[href="/dashboard"]')!
    expect(resumen.getAttribute('aria-label')).toBe('Resumen')
    expect(resumen.dataset.tip).toBe('Resumen')
    act(() => { resumen.focus() })
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Resumen')
    expect(toggle()?.getAttribute('aria-label')).toBe('Expandir menú')
  })

  it('keeps its phone bar: the menu button and the asset search', () => {
    const { el } = mount(ActivoLayout, '/activo/MELI')
    expect(el.querySelector('header button[aria-controls="sidebar"]')?.textContent).toBe('Abrir menú')
    expect(el.querySelector('button[aria-label="Buscar cualquier activo"]')).not.toBeNull()
  })

  it('shares » with Gráficos: pinned on the asset page, pinned on Gráficos, and back', () => {
    const asset = mount(ActivoLayout, '/activo/MELI')
    act(() => asset.toggle()!.click())
    expect(asset.toggle()!.getAttribute('aria-expanded')).toBe('true')
    expect(localStorage.getItem('warren-menu-pinned')).toBe('1')
    expect(document.documentElement.dataset.menu).toBe('pinned')
    asset.unmount()

    const charts = mount(TradingLayout, '/trading')
    expect(charts.toggle()!.getAttribute('aria-expanded')).toBe('true')
    act(() => charts.toggle()!.click())
    charts.unmount()

    expect(mount(ActivoLayout, '/activo/GGAL').toggle()!.getAttribute('aria-expanded')).toBe('false')
  })
})
