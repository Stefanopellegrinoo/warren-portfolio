// odd/tasks/ux-base-global.md S3: after signing in again the user lands on the page they were on,
// and only ever on a same-origin path.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { safeNextPath, loginPath } from '@/lib/login-redirect'

const ORIGIN = 'https://warren.example.com'

const getSession = vi.fn()
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: () => ({ auth: { getSession } }),
}))

beforeEach(() => getSession.mockReset())

describe('safeNextPath', () => {
  it('keeps a same-origin path with its query', () => {
    expect(safeNextPath('/ons/mi-cartera?tab=pagos', ORIGIN)).toBe('/ons/mi-cartera?tab=pagos')
  })

  it.each([['//evil.com'], ['/\\evil.com'], ['https://evil.com/x'], ['/..//evil.com'], [''], [null], [undefined]])(
    'falls back to the Resumen for %j',
    (raw) => {
      expect(safeNextPath(raw, ORIGIN)).toBe('/dashboard')
    },
  )
})

describe('loginPath', () => {
  it('remembers the page and flags an expired session', () => {
    expect(loginPath('/ons/mi-cartera?tab=pagos', true)).toBe('/auth/login?next=%2Fons%2Fmi-cartera%3Ftab%3Dpagos&motivo=sesion')
  })

  it('has no session notice for a user who was never signed in', () => {
    expect(loginPath('/history', false)).toBe('/auth/login?next=%2Fhistory')
  })

  it('round-trips through the login page back to the same path', () => {
    const next = new URL(loginPath('/trading?symbol=AAPL', true), ORIGIN).searchParams.get('next')
    expect(safeNextPath(next, ORIGIN)).toBe('/trading?symbol=AAPL')
  })
})

describe('middleware: protected page without a session', () => {
  async function run(path: string, cookie?: string) {
    getSession.mockResolvedValue({ data: { session: null } })
    const { middleware } = await import('@/middleware')
    const req = new NextRequest(`${ORIGIN}${path}`, { headers: cookie ? { cookie } : {} })
    const res = await middleware(req)
    return new URL(res.headers.get('location')!)
  }

  it('sends a user whose session expired to login, back to the same page', async () => {
    const to = await run('/ons/mi-cartera?tab=pagos', 'sb-abc-auth-token=stale')
    expect(to.pathname).toBe('/auth/login')
    expect(to.searchParams.get('next')).toBe('/ons/mi-cartera?tab=pagos')
    expect(to.searchParams.get('motivo')).toBe('sesion')
  })

  it('shows no expired notice to someone who never signed in', async () => {
    const to = await run('/history')
    expect(to.searchParams.get('next')).toBe('/history')
    expect(to.searchParams.has('motivo')).toBe(false)
  })

  it('treats a chunked session cookie as an expired session', async () => {
    expect((await run('/history', 'sb-abc-auth-token.0=stale')).searchParams.get('motivo')).toBe('sesion')
  })

  it('does not take the sign-up PKCE verifier cookie for an expired session', async () => {
    const to = await run('/history', 'sb-abc-auth-token-code-verifier=x')
    expect(to.searchParams.has('motivo')).toBe(false)
  })
})
