// odd/tasks/ux-base-global.md S3: a user sent back to login because the session expired is told so.
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import LoginPage from '../page'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

describe('LoginPage', () => {
  it('says the session expired when the middleware sent the user here for that', () => {
    const html = renderToStaticMarkup(<LoginPage searchParams={{ next: '/ons', motivo: 'sesion' }} />)
    expect(html).toContain('Tu sesión venció. Ingresá de nuevo para seguir donde estabas.')
  })

  it('shows no notice on a plain visit', () => {
    expect(renderToStaticMarkup(<LoginPage />)).not.toContain('Tu sesión venció')
  })
})
