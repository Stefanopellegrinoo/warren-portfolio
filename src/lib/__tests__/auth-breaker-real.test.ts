// @vitest-environment node
/**
 * S5 with the real auth client (auth-js 2.99.1, odd/tasks/supabase-efficiency.md): with Supabase down,
 * the middleware's refreshes reach it a few times, then once per pause; the session stays stored; a
 * blip, a sign-in and a code exchange are never held back. From the feature's independent verification.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GoTrueClient } from '@supabase/auth-js'
import { authBreakerFetch, OPEN_MS, TRIP_AFTER } from '../auth-breaker'

const URL_ = 'https://abcdefgh.supabase.co/auth/v1'
const KEY = 'sb-abcdefgh-auth-token'
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (exp: number) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', exp, aud: 'authenticated', role: 'authenticated' })}.sig`
const user = { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'a@b.c', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
const session = (exp: number, refresh: string) => ({ access_token: jwt(exp), refresh_token: refresh, expires_at: exp, expires_in: 3600, token_type: 'bearer', user })
const expired = () => session(Math.floor(Date.now() / 1000) - 100, 'r1')
const fresh = () => session(Math.floor(Date.now() / 1000) + 3600, 'r2')

type Mode = 'neterr' | '503' | 'ok'
function network(mode: () => Mode, latency = 0) {
  const calls: string[] = []
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input instanceof Request ? input.url : input))
    if (latency) await new Promise(r => setTimeout(r, latency))
    const m = mode()
    if (m === 'neterr') throw new TypeError('fetch failed')
    if (m === '503') return new Response('{"message":"upstream"}', { status: 503, headers: { 'content-type': 'application/json' } })
    return new Response(JSON.stringify(fresh()), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  return { fn: fn as unknown as typeof fetch, calls, refreshes: () => calls.filter(u => u.includes('grant_type=refresh_token')).length }
}

/** One middleware request: a server-side client over the request's cookies, with an expired session. */
function client(fetchImpl: typeof fetch) {
  const store = new Map<string, string>([[KEY, JSON.stringify(expired())]])
  const storage = { isServer: true, getItem: async (k: string) => store.get(k) ?? null, setItem: async (k: string, v: string) => { store.set(k, v) }, removeItem: async (k: string) => { store.delete(k) } }
  const c = new GoTrueClient({ url: URL_, headers: { apikey: 'anon' }, storageKey: KEY, storage, autoRefreshToken: false, persistSession: true, detectSessionInUrl: false, flowType: 'pkce', fetch: fetchImpl })
  return { c, store }
}

async function refreshOnce(fetchImpl: typeof fetch) {
  const { c, store } = client(fetchImpl)
  const p = c.getSession()
  await vi.advanceTimersByTimeAsync(OPEN_MS + 1_000)
  return { r: await p, sessionKept: store.has(KEY) }
}

describe('the refresh breaker with the real auth client', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-27T12:00:00Z')); vi.spyOn(console, 'warn').mockImplementation(() => {}) })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  for (const mode of ['neterr', '503'] as const) {
    it(`${mode}: one refresh reaches the network ${TRIP_AFTER} times (8 without it); the session stays stored, as without it`, async () => {
      const plain = network(() => mode)
      const before = await refreshOnce(plain.fn)
      const guarded = network(() => mode)
      const after = await refreshOnce(authBreakerFetch(guarded.fn))

      expect(plain.refreshes()).toBe(8)
      expect(guarded.refreshes()).toBe(TRIP_AFTER)
      expect(after.sessionKept).toBe(before.sessionKept)
      expect(after.r.error?.name).toBe(before.r.error?.name)
    })
  }

  it('once open: nothing for the pause, then one probe per pause', async () => {
    const net = network(() => 'neterr')
    const f = authBreakerFetch(net.fn)
    await refreshOnce(f)
    expect(net.refreshes()).toBe(TRIP_AFTER)
    await refreshOnce(f)
    expect(net.refreshes()).toBe(TRIP_AFTER + 1)
    await refreshOnce(f)
    expect(net.refreshes()).toBe(TRIP_AFTER + 2)
  })

  it('a slow outage (5 s per attempt) with 4 page requests a second for 2 minutes stays at a handful of refreshes', async () => {
    const net = network(() => 'neterr', 5_000)
    const f = authBreakerFetch(net.fn)
    const pending: Promise<unknown>[] = []
    for (let t = 0; t < 120_000; t += 250) {
      pending.push(client(f).c.getSession())
      await vi.advanceTimersByTimeAsync(250)
    }
    await vi.advanceTimersByTimeAsync(40_000)
    await Promise.all(pending)

    // The ones already in flight before the first failure (5 s × 4/s), then one probe per pause
    // (2,400 without the breaker; 259 before the probe was alone).
    expect(net.refreshes()).toBeLessThanOrEqual(30)
  }, 30_000) // 480 simulated page requests: slow under a busy full run

  it('a single blip followed by success: the refresh succeeds and stores the new session', async () => {
    let n = 0
    const net = network(() => (n++ === 0 ? 'neterr' : 'ok'))
    const { c, store } = client(authBreakerFetch(net.fn))
    const p = c.getSession()
    await vi.advanceTimersByTimeAsync(5_000)
    const r = await p

    expect(r.error).toBeNull()
    expect(JSON.parse(store.get(KEY)!).refresh_token).toBe('r2')
    expect(net.refreshes()).toBe(2)
  })

  it('a sign-in and a PKCE code exchange reach the auth server while it is open', async () => {
    const net = network(() => 'neterr')
    const f = authBreakerFetch(net.fn)
    await refreshOnce(f)
    const before = net.calls.length
    const { c, store } = client(f)
    const signIn = c.signInWithPassword({ email: 'a@b.c', password: 'x' })
    await vi.advanceTimersByTimeAsync(1_000)
    await signIn
    store.set(`${KEY}-code-verifier`, JSON.stringify('verifier'))
    const exchange = c.exchangeCodeForSession('code123')
    await vi.advanceTimersByTimeAsync(1_000)
    await exchange

    const after = net.calls.slice(before)
    expect(after.some(u => u.includes('grant_type=password'))).toBe(true)
    expect(after.some(u => u.includes('grant_type=pkce'))).toBe(true)
  })
})
