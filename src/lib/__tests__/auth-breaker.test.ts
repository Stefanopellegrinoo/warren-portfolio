/**
 * When Supabase does not answer, a session refresh reaches the network once, not once per retry of every
 * page request (odd/tasks/supabase-efficiency.md S5: 7,845 token requests in 2 minutes on 2026-10-27).
 */
import { describe, it, expect, vi } from 'vitest'
import { authBreakerFetch, OPEN_MS } from '../auth-breaker'

const TOKEN = 'https://x.supabase.co/auth/v1/token?grant_type=refresh_token'

function setup(respond: () => Promise<Response>) {
  const clock = { now: 0 }
  const network = vi.fn(respond)
  const fetch = authBreakerFetch(network as unknown as typeof globalThis.fetch, () => clock.now)
  return { clock, network, fetch }
}

describe('authBreakerFetch', () => {
  it('after a refresh fails on the network, the next ones fail at once without reaching it', async () => {
    const { network, fetch } = setup(async () => { throw new TypeError('fetch failed') })

    await expect(fetch(TOKEN, { method: 'POST' })).rejects.toThrow('fetch failed')
    for (let i = 0; i < 6; i++) await expect(fetch(TOKEN, { method: 'POST' })).rejects.toThrow(TypeError)
    expect(network).toHaveBeenCalledTimes(1)
  })

  it('a 5xx answer opens it too, and after the pause the next refresh reaches the network again', async () => {
    const { clock, network, fetch } = setup(async () => new Response('down', { status: 503 }))

    expect((await fetch(TOKEN)).status).toBe(503)
    await expect(fetch(TOKEN)).rejects.toThrow(TypeError)
    clock.now = OPEN_MS - 1
    await expect(fetch(TOKEN)).rejects.toThrow(TypeError)
    expect(network).toHaveBeenCalledTimes(1)

    clock.now = OPEN_MS
    expect((await fetch(TOKEN)).status).toBe(503)
    expect(network).toHaveBeenCalledTimes(2)
  })

  it('an answer from a working auth server, even a refusal, never opens it', async () => {
    const { network, fetch } = setup(async () => new Response('{"error":"invalid_grant"}', { status: 400 }))

    await fetch(TOKEN)
    await fetch(TOKEN)
    expect(network).toHaveBeenCalledTimes(2)
  })

  it('every other request goes to the network untouched, open or not', async () => {
    const { network, fetch } = setup(async () => { throw new TypeError('fetch failed') })
    await expect(fetch(TOKEN)).rejects.toThrow()

    await expect(fetch('https://x.supabase.co/rest/v1/transactions')).rejects.toThrow('fetch failed')
    await expect(fetch(new URL('https://x.supabase.co/auth/v1/user'))).rejects.toThrow('fetch failed')
    expect(network).toHaveBeenCalledTimes(3)
  })
})
