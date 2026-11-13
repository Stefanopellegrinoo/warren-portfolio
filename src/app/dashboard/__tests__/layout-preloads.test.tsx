// The Resumen's first requests start with the HTML, not after its JS downloads and starts.
import { describe, it, expect, vi } from 'vitest'

const preload = vi.fn()
vi.mock('react-dom', async (orig) => ({ ...(await orig<object>()), preload: (...a: unknown[]) => preload(...a) }))
vi.mock('@/components/shell/AppShell', () => ({ default: ({ children }: { children: React.ReactNode }) => children }))

import AppLayout from '../layout'
import { RESUMEN_FIRST_REQUESTS } from '@/lib/resumen/first-requests'

describe('Resumen layout', () => {
  it('preloads each first request as a same-origin fetch the page can reuse', () => {
    AppLayout({ children: null })

    expect(preload.mock.calls).toEqual(RESUMEN_FIRST_REQUESTS.map(url => [url, { as: 'fetch', crossOrigin: 'anonymous' }]))
  })
})
