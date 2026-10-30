import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderToStaticMarkup, renderToString } from 'react-dom/server'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { forgetCached, setCachedValue } from '@/lib/client-cache'
import { POSITIONS_KEY } from '@/lib/warren/positions'
import { THEME_STORAGE_KEY } from '@/lib/theme'

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

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('next/font/google', () => ({
  IBM_Plex_Sans: () => ({ variable: 'font-sans' }),
  IBM_Plex_Mono: () => ({ variable: 'font-mono' }),
  Newsreader: () => ({ variable: 'font-serif' }),
}))

import AppShell, { useShellMenu } from '../AppShell'
import RootLayout from '@/app/layout'

const render = (path: string) => renderToStaticMarkup(<AppShell pathnameForTest={path}><p>contenido</p></AppShell>)

describe('AppShell', () => {
  it('marks the current section with aria-current', () => {
    const html = render('/history')
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>(?:(?!<\/a>).)*Operaciones/)
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
  })

  it('renders the page content inside main', () => {
    expect(render('/dashboard')).toMatch(/<main[^>]*id="main"[^>]*>.*contenido.*<\/main>/)
  })

  it('has an accessible mobile menu button bound to the sidebar', () => {
    const html = render('/dashboard')
    expect(html).toMatch(/<button[^>]*aria-controls="sidebar"[^>]*aria-expanded="false"/)
    expect(html).toContain('Abrir menú')
    expect(html).toContain('id="sidebar"')
  })

  it('offers the theme choice as a labelled radio group', () => {
    const html = render('/dashboard')
    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('aria-label="Tema"')
    expect(html.match(/type="radio"/g)).toHaveLength(3)
  })

  it('offers the theme choice on every page, an unknown one included', () => {
    const html = render('/not-a-page')
    expect(html).not.toContain('estilo anterior')
    expect(html).not.toMatch(/<fieldset[^>]*disabled/)
  })

  it('carries none of the old decorative classes', () => {
    expect(render('/dashboard')).not.toMatch(/glass|glow|backdrop-blur|gradient/)
  })
})

// odd/tasks/rendimiento.md S7: changing section never asks for the portfolio; the search asks when it opens.
describe('AppShell — the search and the portfolio', () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false }
  afterEach(() => { vi.unstubAllGlobals(); forgetCached(); document.body.innerHTML = '' })

  async function mountShell(path = '/history') {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url)
      return new Response(JSON.stringify(url === '/api/positions' ? { positions: [{ ticker: 'GGAL' }], onPositions: [] } : []))
    }))
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => { root.render(<AppShell pathnameForTest={path}><p>contenido</p></AppShell>) })
    const openSearch = async () => {
      await act(async () => { [...el.querySelectorAll('button')].find(b => b.textContent?.includes('Buscar activo'))!.click() })
      await act(async () => {})
    }
    return { el, urls, openSearch, unmount: () => act(() => root.unmount()) }
  }
  const options = (el: HTMLElement) => [...el.querySelectorAll('[role="option"]')].map(o => o.textContent)

  it('does not ask for the portfolio on mount, and asks once when the search opens', async () => {
    const { el, urls, openSearch, unmount } = await mountShell()
    expect(urls).not.toContain('/api/positions')
    await openSearch()
    expect(urls.filter(u => u === '/api/positions')).toHaveLength(1)
    expect(options(el)).toEqual(['GGALEn cartera'])
    unmount()
  })

  it('offers the portfolio the tab already has without asking for it', async () => {
    setCachedValue(POSITIONS_KEY, { positions: [{ ticker: 'YPF' }], onPositions: [] })
    const { el, urls, openSearch, unmount } = await mountShell()
    await openSearch()
    expect(urls).not.toContain('/api/positions')
    expect(options(el)).toEqual(['YPFEn cartera'])
    unmount()
  })

  // odd/tasks/chart-pro-redesign.md S4: the icon keeps the same search.
  it('on Gráficos the search icon opens the same search, and Ctrl K still does', async () => {
    const { el, unmount } = await mountShell('/trading')
    const dialog = el.querySelector('dialog')!
    await act(async () => { el.querySelector<HTMLElement>('button[aria-label="Buscar activo"]')!.click() })
    expect(dialog.open).toBe(true)
    await act(async () => { dialog.close(); dialog.dispatchEvent(new Event('close')) })
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })) })
    expect(dialog.open).toBe(true)
    unmount()
  })
})

// odd/tasks/grafico-espacio.md S2: on Gráficos the page's own phone bar carries the menu button.
describe('AppShell — a page with its own phone bar', () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  afterEach(() => { document.body.innerHTML = '' })

  function PageBar() {
    const { open, openMenu } = useShellMenu()
    return <button type="button" aria-expanded={open} onClick={e => openMenu(e.currentTarget)}>Menú de la página</button>
  }

  it('renders no bar of its own on Gráficos', () => {
    expect(render('/trading')).not.toContain('Abrir menú')
    expect(render('/dashboard')).toContain('Abrir menú')
  })

  it("the page's button opens the menu, and gets the focus back when it closes", () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    act(() => root.render(<AppShell pathnameForTest="/trading"><PageBar /></AppShell>))
    const button = [...el.querySelectorAll('button')].find(b => b.textContent === 'Menú de la página')!

    act(() => button.click())
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(el.querySelector('#sidebar')!.className).toContain('max-[819px]:translate-x-0')

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(button)
    act(() => root.unmount())
  })
})

// The icon-only look applies from 820 px while <html data-menu="icons">; the root layout's boot
// script sets it from the device's choice before the first paint.
const ICONS = 'min-[820px]:[[data-menu=icons]_&]:'

// odd/tasks/chart-pro-redesign.md S4: a full page load paints the device's choice from the first frame.
describe('AppShell — the first paint of the menu on Gráficos', () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    delete document.documentElement.dataset.menu
    document.body.innerHTML = ''
  })

  const menuBoot = () => {
    const html = renderToStaticMarkup(<RootLayout><p>contenido</p></RootLayout>)
    const script = [...html.matchAll(/<script>(.*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('warren-menu-pinned'))
    expect(script).toBeDefined()
    return (storage: { getItem: (k: string) => string | null }) => {
      const dataset: Record<string, string> = {}
      new Function('document', 'localStorage', script!)({ documentElement: { dataset } }, storage)
      return dataset.menu
    }
  }

  it('the root layout marks <html> from the stored choice before the page paints, defensively', () => {
    const boot = menuBoot()
    expect(boot({ getItem: () => '1' })).toBe('pinned')
    expect(boot({ getItem: () => '0' })).toBe('icons')
    expect(boot({ getItem: () => null })).toBe('icons')
    expect(boot({ getItem: () => { throw new Error('blocked') } })).toBe('icons')
  })

  it('a page load after » paints the full menu: the boot script reads what the button stored', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    act(() => root.render(<AppShell pathnameForTest="/trading"><p>contenido</p></AppShell>))
    act(() => el.querySelector<HTMLButtonElement>('button[aria-controls="sidebar"]')!.click())
    act(() => root.unmount())
    expect(menuBoot()(localStorage)).toBe('pinned')
  })

  it('the server markup carries both widths and <html data-menu> picks one', () => {
    const el = document.createElement('div')
    el.innerHTML = render('/trading')
    const grid = el.firstElementChild!.classList
    expect(grid.contains('min-[820px]:grid-cols-[264px_minmax(0,1fr)]')).toBe(true)
    expect(grid.contains(`${ICONS}grid-cols-[64px_minmax(0,1fr)]`)).toBe(true)
    expect(el.querySelector('button[aria-controls="sidebar"]')!.textContent).toBe('Contraer menú')
  })

  it('the server markup carries both theme controls and <html data-menu> picks one', () => {
    const el = document.createElement('div')
    el.innerHTML = render('/trading')
    const cycle = el.querySelector('button[aria-label^="Tema:"]')!
    expect(cycle.classList.contains('hidden')).toBe(true)
    expect(cycle.classList.contains(`${ICONS}grid`)).toBe(true)
    expect(el.querySelector('[role="radiogroup"]')!.parentElement!.classList.contains(`${ICONS}hidden`)).toBe(true)
  })

  it('hydrates a pinned device without a mismatch warning, then » reads as open', () => {
    localStorage.setItem('warren-menu-pinned', '1')
    document.documentElement.dataset.menu = 'pinned'
    const el = document.createElement('div')
    el.innerHTML = renderToString(<AppShell pathnameForTest="/trading"><p>contenido</p></AppShell>)
    document.body.appendChild(el)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    let root: ReturnType<typeof hydrateRoot> | undefined
    act(() => { root = hydrateRoot(el, <AppShell pathnameForTest="/trading"><p>contenido</p></AppShell>) })
    expect(errors).not.toHaveBeenCalled()
    expect(el.querySelector('button[aria-controls="sidebar"]')!.getAttribute('aria-expanded')).toBe('true')
    expect(document.documentElement.dataset.menu).toBe('pinned')
    // Nothing is swapped after hydration: both theme controls stay and CSS keeps showing the group.
    expect(el.querySelector('button[aria-label^="Tema:"]')).not.toBeNull()
    expect(el.querySelector('[role="radiogroup"]')).not.toBeNull()
    act(() => root!.unmount())
  })
})

// odd/tasks/chart-pro-redesign.md S4: on Gráficos, from 820 px, the menu keeps only its icons.
describe('AppShell — the icon-only menu on Gráficos', () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.menu
    document.body.innerHTML = ''
  })

  const LABELS = ['Resumen', 'Gráficos', 'Operaciones', 'Rendimiento', 'Obligaciones negociables', 'Estrategias y alertas', 'Gastos']
  function mount(path = '/trading') {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    act(() => root.render(<AppShell pathnameForTest={path}><p>contenido</p></AppShell>))
    const named = (label: string) => el.querySelector<HTMLElement>(`[aria-label="${label}"]`)
    const button = (text: string) => [...el.querySelectorAll('button')].find(b => b.textContent?.includes(text))
    // On Gráficos the shell draws no phone bar, so the only button bound to the menu is » / «.
    const toggle = () => el.querySelector<HTMLButtonElement>('button[aria-controls="sidebar"]')!
    return { el, named, button, toggle, unmount: () => act(() => root.unmount()) }
  }
  // Hidden below 820 px: the element or an ancestor inside the menu carries an unprefixed hiding class.
  const hiddenOnPhone = (node: Element) => {
    for (let n: Element | null = node; n && n.id !== 'sidebar'; n = n.parentElement) {
      if (n.classList.contains('hidden') || n.classList.contains('sr-only')) return true
    }
    return false
  }

  it('shows only the icons from 820 px: a 64 px column, each entry named by its aria-label', () => {
    const { el, named } = mount()
    expect(el.firstElementChild!.classList.contains(`${ICONS}grid-cols-[64px_minmax(0,1fr)]`)).toBe(true)
    for (const label of [...LABELS, 'Buscar activo', 'Cerrar sesión']) {
      const entry = named(label)
      expect(entry, label).not.toBeNull()
      const text = entry!.querySelector('span')!
      expect(text.textContent, label).toBe(label)
      expect(text.classList.contains(`${ICONS}hidden`), label).toBe(true)
    }
    expect(el.querySelector('#sidebar')!.textContent).toContain('W')
  })

  // The asset page's layout asks for this menu (odd/tasks/asset-page.md L24); Gráficos needs no asking.
  it('comes from Gráficos’ own path: the same markup, no phone bar, whether a layout asks for it or not', () => {
    const asked = renderToStaticMarkup(<AppShell pathnameForTest="/trading" iconMenu><p>contenido</p></AppShell>)
    expect(render('/trading')).toBe(asked)
    expect(asked).toContain('grid-cols-[64px_minmax(0,1fr)]')
    expect(asked).not.toContain('Abrir menú')
  })

  it('keeps aria-current on the active entry', () => {
    const { el } = mount('/trading/GGAL')
    const current = el.querySelectorAll('a[aria-current="page"]')
    expect(current).toHaveLength(1)
    expect(current[0].getAttribute('aria-label')).toBe('Gráficos')
  })

  it('names each entry in a tooltip on hover and on keyboard focus, without taking the focus', () => {
    const { el, named } = mount()
    const tip = () => document.querySelector('[role="tooltip"]')
    const link = named('Operaciones')!

    act(() => { link.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })) })
    expect(tip()?.textContent).toBe('Operaciones')
    act(() => { link.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body })) })
    expect(tip()).toBeNull()

    act(() => { named('Buscar activo')!.focus() })
    expect(tip()?.textContent).toBe('Buscar activo · Ctrl K')
    expect(document.activeElement).toBe(named('Buscar activo'))
    act(() => { named('Buscar activo')!.blur() })
    expect(tip()).toBeNull()

    act(() => { link.focus() })
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(tip()).toBeNull()
    expect(document.activeElement).toBe(link)
  })

  it('draws the tooltip above the chart, outside the scrolling menu', () => {
    const { el, named } = mount()
    act(() => { named('Gastos')!.focus() })
    const tip = document.querySelector('[role="tooltip"]')!
    expect(el.querySelector('#sidebar')!.contains(tip)).toBe(false)
    expect(tip.className).toContain('fixed')
    expect(tip.className).toContain('pointer-events-none')
    // The chart's pane separators sit at z-index 50.
    expect(Number(tip.className.match(/z-\[(\d+)\]/)?.[1])).toBeGreaterThan(50)
  })

  it('turns the Personal heading into a divider that still names its group', () => {
    const { el } = mount()
    const heading = el.querySelector('#h-personal')!
    expect(heading.textContent).toBe('Personal')
    expect(heading.classList.contains(`${ICONS}sr-only`)).toBe(true)
  })

  it('cycles the theme Claro → Oscuro → Auto with one button, the same choice as the radio group', () => {
    const { el } = mount()
    const cycle = () => el.querySelector<HTMLButtonElement>('button[aria-label^="Tema:"]')!
    expect(cycle().getAttribute('aria-label')).toBe('Tema: Auto')

    act(() => cycle().click())
    expect(cycle().getAttribute('aria-label')).toBe('Tema: Claro')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect(el.querySelector<HTMLInputElement>('input[value="light"]')!.checked).toBe(true)

    act(() => cycle().click())
    expect(cycle().getAttribute('aria-label')).toBe('Tema: Oscuro')
    expect(document.documentElement.dataset.theme).toBe('dark')

    act(() => cycle().click())
    expect(cycle().getAttribute('aria-label')).toBe('Tema: Auto')
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system')
  })

  it('» pins the full menu open, « folds it back, and the device remembers', () => {
    const first = mount()
    expect(first.toggle().getAttribute('aria-label')).toBe('Expandir menú')
    expect(first.toggle().getAttribute('aria-expanded')).toBe('false')
    act(() => first.toggle().click())
    expect(first.toggle().getAttribute('aria-expanded')).toBe('true')
    // Named by its visible label once open.
    expect(first.toggle().hasAttribute('aria-label')).toBe(false)
    expect(first.toggle().textContent).toBe('Contraer menú')
    expect(document.documentElement.dataset.menu).toBe('pinned')
    expect(first.el.querySelector('a[data-tip]')).toBeNull()
    act(() => { first.el.querySelector<HTMLElement>('a[href="/history"]')!.focus() })
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    first.unmount()

    const again = mount()
    expect(again.toggle().getAttribute('aria-expanded')).toBe('true')
    act(() => again.toggle().click())
    expect(again.toggle().getAttribute('aria-label')).toBe('Expandir menú')
    expect(document.documentElement.dataset.menu).toBe('icons')
    again.unmount()
    expect(mount().toggle().getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps the phone drawer as it is below 820 px: full labels, no » and no theme button', () => {
    const { el, named, button } = mount()
    for (const label of [...LABELS, 'Buscar activo', 'Cerrar sesión']) {
      expect(hiddenOnPhone(named(label)!.querySelector('span')!), label).toBe(false)
    }
    expect(hiddenOnPhone(el.querySelector('#h-personal')!)).toBe(false)
    expect(hiddenOnPhone(el.querySelector('[role="radiogroup"]')!)).toBe(false)
    expect(hiddenOnPhone(button('Ctrl K')!.querySelector('kbd')!)).toBe(false)
    expect(hiddenOnPhone(named('Expandir menú')!)).toBe(true)
    expect(hiddenOnPhone(el.querySelector('button[aria-label^="Tema:"]')!)).toBe(true)
  })

  it('leaves every other page as it was: no icon-only menu, no » and the theme radio group', () => {
    for (const path of ['/dashboard', '/history', '/cashflow', '/not-a-page']) {
      const html = render(path)
      expect(html, path).toContain('min-[820px]:grid-cols-[264px_minmax(0,1fr)]')
      expect(html, path).not.toMatch(/data-tip|Expandir menú|Contraer menú|Tema:/)
      expect(html.match(/type="radio"/g), path).toHaveLength(3)
    }
  })

  // Last on purpose: a refused write keeps the choice for the session, as the theme does.
  it('works without storage: the menu renders folded and » still pins it for the session', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const { toggle } = mount()
    act(() => toggle().click())
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    expect(document.documentElement.dataset.menu).toBe('pinned')
  })
})

// odd/tasks/asset-page.md S1: the asset search on every page but Gráficos; on a phone, behind the bar's button.
describe('AppShell — the asset search', () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  afterEach(() => { vi.unstubAllGlobals(); forgetCached(); document.body.innerHTML = '' })

  function mount(path: string) {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    act(() => root.render(<AppShell pathnameForTest={path}><p>contenido</p></AppShell>))
    return { el, unmount: () => act(() => root.unmount()) }
  }
  const input = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input[aria-label="Buscar cualquier activo"]')

  it('the phone bar button opens the search with the keyboard in it', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    const { el, unmount } = mount('/dashboard')
    const open = el.querySelector<HTMLButtonElement>('header button[aria-label="Buscar cualquier activo"]')!
    expect(open.getAttribute('aria-expanded')).toBe('false')
    act(() => open.click())
    expect(open.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(input(el))
    act(() => el.querySelector<HTMLButtonElement>('button[aria-label="Cerrar búsqueda"]')!.click())
    expect(open.getAttribute('aria-expanded')).toBe('false')
    unmount()
  })

  it('is not on Gráficos, which has its own symbol search', () => {
    const { el, unmount } = mount('/trading')
    expect(input(el)).toBeNull()
    unmount()
  })
})
