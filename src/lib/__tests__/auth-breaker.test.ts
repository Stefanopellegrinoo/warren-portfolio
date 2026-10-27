/**
 * When Supabase does not answer, session refreshes reach the network a few times, not once per retry of every
 * page request (odd/tasks/supabase-efficiency.md S5: 7,845 token requests in 2 minutes on 2026-10-27).
 */
import { describe, it, expect, vi } from 'vitest'
import { authBreakerFetch, OPEN_MS, TRIP_AFTER } from '../auth-breaker'

const TOKEN = 'https://x.supabase.co/auth/v1/token?grant_type=refresh_token'

function setup(respond: () => Promise<Response>) {
  const clock = { now: 0 }
  const network = vi.fn(respond)
  const fetch = authBreakerFetch(network as unknown as typeof globalThis.fetch, () => clock.now)
  return { clock, network, fetch }
}

describe('authBreakerFetch', () => {
  it('after refreshes fail on the network a few times in a row, the next ones fail at once without reaching it', async () => {
    const { network, fetch } = setup(async () => { throw new TypeError('fetch failed') })

    for (let i = 0; i < TRIP_AFTER; i++) await expect(fetch(TOKEN, { method: 'POST' })).rejects.toThrow('fetch failed')
    for (let i = 0; i < 6; i++) await expect(fetch(TOKEN, { method: 'POST' })).rejects.toThrow(TypeError)
    expect(network).toHaveBeenCalledTimes(TRIP_AFTER)
  })

  it('a single blip never trips it: the auth client\'s own next attempt reaches the network and succeeds', async () => {
    const { network, fetch } = setup(async () => new Response('{}', { status: 200 }))
    network.mockRejectedValueOnce(new TypeError('connection reset'))

    await expect(fetch(TOKEN)).rejects.toThrow('connection reset')
    expect((await fetch(TOKEN)).status).toBe(200)
    // A success resets the count: blips spread over time never add up.
    network.mockRejectedValueOnce(new TypeError('reset')).mockRejectedValueOnce(new TypeError('reset'))
    await expect(fetch(TOKEN)).rejects.toThrow()
    await expect(fetch(TOKEN)).rejects.toThrow()
    expect((await fetch(TOKEN)).status).toBe(200)
  })

  it('5xx answers open it too, and after the pause the next refresh reaches the network again', async () => {
    const { clock, network, fetch } = setup(async () => new Response('down', { status: 503 }))

    for (let i = 0; i < TRIP_AFTER; i++) expect((await fetch(TOKEN)).status).toBe(503)
    await expect(fetch(TOKEN)).rejects.toThrow(TypeError)
    clock.now = OPEN_MS - 1
    await expect(fetch(TOKEN)).rejects.toThrow(TypeError)
    expect(network).toHaveBeenCalledTimes(TRIP_AFTER)

    clock.now = OPEN_MS
    expect((await fetch(TOKEN)).status).toBe(503)
    expect(network).toHaveBeenCalledTimes(TRIP_AFTER + 1)
  })

  it('an answer from a working auth server, even a refusal, never opens it', async () => {
    const { network, fetch } = setup(async () => new Response('{"error":"invalid_grant"}', { status: 400 }))

    await fetch(TOKEN)
    await fetch(TOKEN)
    expect(network).toHaveBeenCalledTimes(2)
  })

  it('every other request goes to the network untouched, open or not', async () => {
    const { network, fetch } = setup(async () => { throw new TypeError('fetch failed') })
    for (let i = 0; i < TRIP_AFTER; i++) await expect(fetch(TOKEN)).rejects.toThrow()

    await expect(fetch('https://x.supabase.co/rest/v1/transactions')).rejects.toThrow('fetch failed')
    await expect(fetch(new URL('https://x.supabase.co/auth/v1/user'))).rejects.toThrow('fetch failed')
    expect(network).toHaveBeenCalledTimes(TRIP_AFTER + 2)
  })
})
