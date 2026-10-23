// T1 (odd/tasks/security-hardening.md S1): requireUser trusts only an identity
// the Auth server verified, never the user object stored in the cookie.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const auth = { getSession: vi.fn(), getUser: vi.fn() }
vi.mock('@/lib/supabase-server', () => ({ createServerClientInstance: () => ({ auth }) }))
const rateLimit = vi.fn()
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  rateLimit: (...a: unknown[]) => rateLimit(...a),
}))

import { AuthRetryableFetchError } from '@supabase/supabase-js'
import { requireUser, isAuthFailure } from '@/lib/api-auth'

const victim = { id: '00000000-0000-0000-0000-000000000001' }

beforeEach(() => {
  auth.getSession.mockReset()
  auth.getUser.mockReset()
  rateLimit.mockReset().mockResolvedValue(true)
})

describe('requireUser', () => {
  it('rejects a forged cookie: a session is present but the Auth server rejects its JWT', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: victim } }, error: null })
    auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid JWT' } })

    const result = await requireUser()

    expect(isAuthFailure(result)).toBe(true)
    if (isAuthFailure(result)) expect(result.error.status).toBe(401)
  })

  it('returns the user the Auth server verified', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'cookie-claim' } } }, error: null })
    auth.getUser.mockResolvedValue({ data: { user: victim }, error: null })

    const result = await requireUser()

    expect(isAuthFailure(result)).toBe(false)
    if (!isAuthFailure(result)) expect(result.user).toEqual(victim)
  })

  it('still rejects a request with no session at all', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'Auth session missing!' } })

    const result = await requireUser()

    expect(isAuthFailure(result)).toBe(true)
    if (isAuthFailure(result)) expect(result.error.status).toBe(401)
  })

  // T5 (S5): one global per-user budget across every authenticated route.
  it('answers 429 once the verified user is over 300 requests per 60 s', async () => {
    auth.getUser.mockResolvedValue({ data: { user: victim }, error: null })
    rateLimit.mockResolvedValue(false)

    const result = await requireUser()

    expect(rateLimit).toHaveBeenCalledWith(`rl:user:${victim.id}`, 300, 60)
    expect(isAuthFailure(result)).toBe(true)
    if (isAuthFailure(result)) expect(result.error.status).toBe(429)
  })

  // T5 (L4 b): an Auth outage is not a bad session.
  it.each([
    ['a network failure', new AuthRetryableFetchError('fetch failed', 0)],
    ['a 5xx from the Auth server', { message: 'Internal Server Error', status: 500 }],
  ])('answers 503 when getUser fails with %s', async (_label, error) => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error })

    const result = await requireUser()

    expect(isAuthFailure(result)).toBe(true)
    if (isAuthFailure(result)) {
      expect(result.error.status).toBe(503)
      expect(await result.error.json()).toEqual({ error: 'Servicio de autenticación no disponible' })
    }
  })
})
