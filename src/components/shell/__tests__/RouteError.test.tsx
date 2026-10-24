// odd/tasks/ux-base-global.md S4: a screen that fails says, in Spanish, what happened and how to go on.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import RouteError from '../RouteError'
import NotFound from '@/app/not-found'

const render = (error: Error & { digest?: string }) => renderToStaticMarkup(<RouteError error={error} reset={() => {}} />)
const chunkError = () => Object.assign(new Error('Loading chunk 742 failed.'), { name: 'ChunkLoadError' })

afterEach(() => vi.unstubAllGlobals())

describe('RouteError', () => {
  it('asks to reload when a new version replaced the code the page needs', () => {
    const html = render(chunkError())
    expect(html).toContain('Hay una versión nueva de Warren')
    expect(html).toContain('Recargar')
    expect(render(new TypeError('Failed to fetch dynamically imported module: /_next/x.js'))).toContain('Hay una versión nueva de Warren')
  })

  it('says there is no connection when the device is offline, whatever failed', () => {
    vi.stubGlobal('navigator', { onLine: false })
    const html = render(chunkError())
    expect(html).toContain('Sin conexión')
    expect(html).toContain('Reintentar')
    expect(html).not.toContain('versión nueva')
  })

  it('explains an unexpected failure, offers a retry and a way back, and shows the error code', () => {
    const html = render(Object.assign(new Error('Cannot read properties of undefined'), { digest: '1234567' }))
    expect(html).toContain('No se pudo mostrar esta pantalla')
    expect(html).toContain('Reintentar')
    expect(html).toMatch(/<a[^>]*href="\/dashboard"[^>]*>Ir al Resumen<\/a>/)
    expect(html).toContain('1234567')
    expect(html).not.toContain('Cannot read properties')
  })
})

describe('not-found', () => {
  it('says the page does not exist and links back to the Resumen', () => {
    const html = renderToStaticMarkup(<NotFound />)
    expect(html).toContain('No encontramos esta página')
    expect(html).toMatch(/<a[^>]*href="\/dashboard"[^>]*>Ir al Resumen<\/a>/)
  })
})
