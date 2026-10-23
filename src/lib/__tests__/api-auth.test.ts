// T1 (odd/tasks/security-hardening.md S1): requireUser trusts only an identity
// the Auth server verified, never the user object stored in the cookie.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const auth = { getSession: vi.fn(), getUser: vi.fn() }
vi.mock('@/lib/supabase-server', () => ({ createServerClientInstance: () => ({ auth }) }))

import { requireUser, isAuthFailure } from '@/lib/api-auth'

const victim = { id: '00000000-0000-0000-0000-000000000001' }

beforeEach(() => {
  auth.getSession.mockReset()
  auth.getUser.mockReset()
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
})
