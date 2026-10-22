import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

import AppShell from '../AppShell'

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

  it('disables the theme choice on pages that still use the old style', () => {
    expect(render('/history')).toContain('Esta página todavía usa el estilo anterior')
    expect(render('/dashboard')).not.toContain('Esta página todavía usa el estilo anterior')
  })

  it('carries none of the old decorative classes', () => {
    expect(render('/dashboard')).not.toMatch(/glass|glow|backdrop-blur|gradient/)
  })
})
