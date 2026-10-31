// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('../supabase-server', () => ({
  createSupabaseServerClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}))

import { middleware, config } from '../../middleware'

describe('middleware: the asset page needs a session', () => {
  it('runs on /activo and its subpaths', () => {
    expect(config.matcher).toContain('/activo/:path*')
  })

  it('sends a signed-out visitor of /activo/MELI to the login, coming back to the page', async () => {
    const res = await middleware(new NextRequest('https://warren.example/activo/MELI?vs=AMZN'))

    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/auth/login')
    expect(location.search).toContain(encodeURIComponent('/activo/MELI?vs=AMZN'))
  })
})

describe('middleware: the market page needs a session', () => {
  it('runs on /mercado and its subpaths', () => {
    expect(config.matcher).toContain('/mercado/:path*')
  })

  it('sends a signed-out visitor of /mercado to the login, coming back to the same list', async () => {
    const res = await middleware(new NextRequest('https://warren.example/mercado?lista=cedears'))

    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/auth/login')
    expect(location.search).toContain(encodeURIComponent('/mercado?lista=cedears'))
  })
})
