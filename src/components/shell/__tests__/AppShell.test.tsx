import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { forgetCached, setCachedValue } from '@/lib/client-cache'
import { POSITIONS_KEY } from '@/lib/warren/positions'

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

import AppShell, { useShellMenu } from '../AppShell'

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

  async function mountShell() {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url)
      return new Response(JSON.stringify(url === '/api/positions' ? { positions: [{ ticker: 'GGAL' }], onPositions: [] } : []))
    }))
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => { root.render(<AppShell pathnameForTest="/history"><p>contenido</p></AppShell>) })
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
