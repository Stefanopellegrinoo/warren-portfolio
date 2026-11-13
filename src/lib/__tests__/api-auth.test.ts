// T1 (odd/tasks/security-hardening.md S1): requireUser trusts only an identity whose JWT
// signature was verified, never the user object stored in the cookie. Since the project signs
// with an asymmetric key (ES256), getClaims() verifies that signature locally against the
// published JWKS instead of asking the Auth server on every request.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AuthClient } from '@supabase/auth-js'

let auth: any
vi.mock('@/lib/supabase-server', () => ({ createServerClientInstance: () => ({ auth }) }))
const rateLimit = vi.fn()
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  rateLimit: (...a: unknown[]) => rateLimit(...a),
}))

import { AuthRetryableFetchError } from '@supabase/supabase-js'
import { requireUser, isAuthFailure, SESSION_EXPIRED } from '@/lib/api-auth'

const victim = '00000000-0000-0000-0000-000000000001'
const mocked = () => ({ getSession: vi.fn(), getUser: vi.fn(), getClaims: vi.fn() })

beforeEach(() => {
  auth = mocked()
  rateLimit.mockReset().mockResolvedValue(true)
})

// A real ES256 key pair, a JWT signed with it, and an Auth client that serves its public key
// as the project's JWKS: the same verification path production runs, without a network.
const b64url = (b: ArrayBuffer | Uint8Array | string) =>
  Buffer.from(typeof b === 'string' ? b : b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64url')

async function keyPair(kid: string) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid, alg: 'ES256', use: 'sig' }
  return { privateKey: pair.privateKey, jwk }
}

async function signJwt(privateKey: CryptoKey, kid: string, payload: Record<string, unknown>) {
  const head = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid }))
  const body = b64url(JSON.stringify(payload))
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(`${head}.${body}`))
  return `${head}.${body}.${b64url(sig)}`
}

function realAuth(jwks: object[], accessToken: string, jwksAnswer?: () => Promise<Response>) {
  const fetchStub = vi.fn(async (url: string) => {
    if (String(url).endsWith('/.well-known/jwks.json')) return jwksAnswer ? jwksAnswer() : new Response(JSON.stringify({ keys: jwks }), { status: 200 })
    return new Response(JSON.stringify({ message: 'unexpected Auth call' }), { status: 500 })
  })
  const client = new AuthClient({ url: 'http://auth.test/auth/v1', persistSession: false, autoRefreshToken: false, fetch: fetchStub as unknown as typeof fetch })
  vi.spyOn(client, 'getSession').mockResolvedValue({ data: { session: { access_token: accessToken } }, error: null } as never)
  return { client, fetchStub }
}

const inAnHour = () => Math.floor(Date.now() / 1000) + 3600

describe('requireUser with real signature verification', () => {
  it('returns the user id from a JWT signed by the project key, without asking the Auth server for the user', async () => {
    const { privateKey, jwk } = await keyPair('k-valid')
    const token = await signJwt(privateKey, 'k-valid', { sub: victim, role: 'authenticated', exp: inAnHour() })
    const { client, fetchStub } = realAuth([jwk], token)
    auth = client

    const result = await requireUser()

    expect(isAuthFailure(result)).toBe(false)
    if (!isAuthFailure(result)) expect(result.user.id).toBe(victim)
    expect(fetchStub.mock.calls.map(c => String(c[0]))).not.toContainEqual(expect.stringContaining('/user'))
  })

  it('rejects a forged JWT: same kid and claims, signed by another key', async () => {
    const project = await keyPair('k-forged')
    const attacker = await keyPair('k-forged')
    const token = await signJwt(attacker.privateKey, 'k-forged', { sub: victim, role: 'authenticated', exp: inAnHour() })
    auth = realAuth([project.jwk], token).client

    const result = await requireUser()

    expect(isAuthFailure(result)).toBe(true)
    if (isAuthFailure(result)) {
      expect(result.error.status).toBe(401)
      expect(await result.error.json()).toEqual({ error: SESSION_EXPIRED })
    }
  })

  it('rejects an expired JWT even with a valid signature', async () => {
    const { privateKey, jwk } = await keyPair('k-expired')
    const token = await signJwt(privateKey, 'k-expired', { sub: victim, role: 'authenticated', exp: Math.floor(Date.now() / 1000) - 60 })
    auth = realAuth([jwk], token).client

    const result = await requireUser()

    expect(isAuthFailure(result)).toBe(true)
    if (isAuthFailure(result)) {
      expect(result.error.status).toBe(401)
      expect(await result.error.json()).toEqual({ error: SESSION_EXPIRED })
    }
  })

  // An Auth outage while fetching the signing keys is not a bad session: 503, not a logout.
  it.each([
    ['a network failure', () => Promise.reject(new TypeError('fetch failed'))],
    ['a 503 from the Auth server', async () => new Response('unavailable', { status: 503 })],
  ])('answers 503 when the JWKS fetch fails with %s', async (label, jwksAnswer) => {
    const kid = `k-outage-${label}`
    const { privateKey, jwk } = await keyPair(kid)
    const token = await signJwt(privateKey, kid, { sub: victim, role: 'authenticated', exp: inAnHour() })
    auth = realAuth([jwk], token, jwksAnswer).client

    const result = await requireUser()

    expect(isAuthFailure(result)).toBe(true)
    if (isAuthFailure(result)) expect(result.error.status).toBe(503)
  })
})

describe('requireUser', () => {
  it('lets an unexpected failure through as a server error instead of logging the user out', async () => {
    auth.getClaims.mockRejectedValue(new TypeError('crypto.subtle is undefined'))

    await expect(requireUser()).rejects.toThrow('crypto.subtle is undefined')
  })

  it('still rejects a request with no session at all', async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: null })

    const result = await requireUser()

    expect(isAuthFailure(result)).toBe(true)
    if (isAuthFailure(result)) {
      expect(result.error.status).toBe(401)
      expect(await result.error.json()).toEqual({ error: SESSION_EXPIRED })
    }
    expect(SESSION_EXPIRED).toBe('Tu sesión venció. Volvé a ingresar.')
  })

  // T5 (S5): one global per-user budget across every authenticated route.
  it('answers 429 once the verified user is over 300 requests per 60 s', async () => {
    auth.getClaims.mockResolvedValue({ data: { claims: { sub: victim } }, error: null })
    rateLimit.mockResolvedValue(false)

    const result = await requireUser()

    expect(rateLimit).toHaveBeenCalledWith(`rl:user:${victim}`, 300, 60)
    expect(isAuthFailure(result)).toBe(true)
    if (isAuthFailure(result)) expect(result.error.status).toBe(429)
  })

  // T5 (L4 b): an Auth outage (the JWKS fetch or a token refresh) is not a bad session.
  it.each([
    ['a network failure', new AuthRetryableFetchError('fetch failed', 0)],
    ['a 5xx from the Auth server', { message: 'Internal Server Error', status: 500 }],
  ])('answers 503 when verification fails with %s', async (_label, error) => {
    auth.getClaims.mockResolvedValue({ data: null, error })

    const result = await requireUser()

    expect(isAuthFailure(result)).toBe(true)
    if (isAuthFailure(result)) {
      expect(result.error.status).toBe(503)
      expect(await result.error.json()).toEqual({ error: 'No se pudo verificar tu sesión. Probá de nuevo en unos minutos.' })
    }
  })
})
