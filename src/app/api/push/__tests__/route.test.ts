// odd/tasks/push-notificaciones.md S3: the app gets the public key at runtime, saves and removes this
// device's subscription for the signed-in user, and refuses any endpoint that is not a push service.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mockRequireUser = vi.fn()
vi.mock('@/lib/api-auth', () => ({ requireUser: () => mockRequireUser(), isAuthFailure: (r: object) => 'error' in r }))

const { GET, POST, DELETE } = await import('../route')

const APPLE = 'https://web.push.apple.com/QGuQyavXutnMH'
const calls: { op: string; args: unknown[] }[] = []
function signedIn(error: unknown = null) {
  const supabase = {
    from: (table: string) => {
      calls.push({ op: 'from', args: [table] })
      return {
        upsert: (...args: unknown[]) => { calls.push({ op: 'upsert', args }); return Promise.resolve({ error }) },
        delete: () => {
          const filters: unknown[] = []
          const chain = { eq: (...args: unknown[]) => { filters.push(args); return filters.length === 2 ? (calls.push({ op: 'delete', args: filters }), Promise.resolve({ error })) : chain } }
          return chain
        },
      }
    },
  }
  mockRequireUser.mockResolvedValue({ supabase, user: { id: 'u1' } })
}
const req = (method: string, body?: string) =>
  new NextRequest('http://localhost/api/push', { method, body, headers: { 'user-agent': 'iPhone Safari' } })

beforeEach(() => { calls.length = 0; vi.stubEnv('VAPID_PUBLIC_KEY', 'BPublicKey') })
afterEach(() => vi.unstubAllEnvs())

describe('GET /api/push', () => {
  it('answers the public key from the runtime env', async () => {
    signedIn()
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ publicKey: 'BPublicKey' })
  })

  it('says in Spanish when push is not configured on the server', async () => {
    signedIn()
    vi.stubEnv('VAPID_PUBLIC_KEY', '')
    const res = await GET()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Los avisos todavía no están configurados en el servidor.' })
  })

  it('passes an auth failure through', async () => {
    mockRequireUser.mockResolvedValue({ error: NextResponse.json({ error: 'Tu sesión venció. Volvé a ingresar.' }, { status: 401 }) })
    expect((await GET()).status).toBe(401)
  })
})

describe('POST /api/push', () => {
  it('saves this device for the signed-in user, once per endpoint', async () => {
    signedIn()
    const res = await POST(req('POST', JSON.stringify({ endpoint: APPLE, keys: { p256dh: 'BKey', auth: 'secret' }, user_id: 'someone-else' })))
    expect(res.status).toBe(201)
    expect(calls).toEqual([
      { op: 'from', args: ['push_subscriptions'] },
      { op: 'upsert', args: [{ user_id: 'u1', endpoint: APPLE, p256dh: 'BKey', auth: 'secret', user_agent: 'iPhone Safari' }, { onConflict: 'user_id,endpoint' }] },
    ])
  })

  it.each(['http://169.254.169.254/latest', 'https://evil.example/push'])('refuses %s with a Spanish 400 and saves nothing', async (endpoint) => {
    signedIn()
    const res = await POST(req('POST', JSON.stringify({ endpoint, keys: { p256dh: 'BKey', auth: 'secret' } })))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Este navegador no ofrece notificaciones compatibles.')
    expect(calls).toEqual([])
  })

  it('a body that is not JSON is a 400', async () => {
    signedIn()
    expect((await POST(req('POST', '{"endpoint": '))).status).toBe(400)
    expect(calls).toEqual([])
  })

  it('a failed save is a 500 with the generic message', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    signedIn({ message: 'down' })
    const res = await POST(req('POST', JSON.stringify({ endpoint: APPLE, keys: { p256dh: 'BKey', auth: 'secret' } })))
    expect(res.status).toBe(500)
    err.mockRestore()
  })
})

describe('DELETE /api/push', () => {
  it('removes only this device of the signed-in user', async () => {
    signedIn()
    const res = await DELETE(req('DELETE', JSON.stringify({ endpoint: APPLE })))
    expect(res.status).toBe(204)
    expect(calls.at(-1)).toEqual({ op: 'delete', args: [['user_id', 'u1'], ['endpoint', APPLE]] })
  })
})
