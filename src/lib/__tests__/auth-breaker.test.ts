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

  it('after the pause one refresh probes; the ones that start while it waits are skipped (a slow outage)', async () => {
    let release: (r: Response) => void = () => {}
    const { clock, network, fetch } = setup(async () => new Response('down', { status: 503 }))
    for (let i = 0; i < TRIP_AFTER; i++) await fetch(TOKEN)
    clock.now = OPEN_MS
    network.mockImplementationOnce(() => new Promise<Response>(r => { release = r }))

    const probe = fetch(TOKEN)
    for (let i = 0; i < 5; i++) await expect(fetch(TOKEN)).rejects.toThrow('refresh skipped')
    expect(network).toHaveBeenCalledTimes(TRIP_AFTER + 1)
    release(new Response('{}', { status: 200 }))
    expect((await probe).status).toBe(200)
    // The probe got through: closed again.
    expect((await fetch(TOKEN)).status).toBe(503)
  })

  it('a healthy server is never limited: many refreshes at once all reach it', async () => {
    const { network, fetch } = setup(async () => new Response('{}', { status: 200 }))
    const all = await Promise.all(Array.from({ length: 10 }, () => fetch(TOKEN)))

    expect(all.every(r => r.status === 200)).toBe(true)
    expect(network).toHaveBeenCalledTimes(10)
  })

  it('an answer from a working auth server, even a refusal, never opens it', async () => {
    const { network, fetch } = setup(async () => new Response('{"error":"invalid_grant"}', { status: 400 }))

    await fetch(TOKEN)
    await fetch(TOKEN)
    expect(network).toHaveBeenCalledTimes(2)
  })

  it('every other request, a sign-in or code exchange included, goes to the network untouched, open or not', async () => {
    const { network, fetch } = setup(async () => { throw new TypeError('fetch failed') })
    for (let i = 0; i < TRIP_AFTER; i++) await expect(fetch(TOKEN)).rejects.toThrow()

    await expect(fetch('https://x.supabase.co/rest/v1/transactions')).rejects.toThrow('fetch failed')
    await expect(fetch(new URL('https://x.supabase.co/auth/v1/user'))).rejects.toThrow('fetch failed')
    await expect(fetch('https://x.supabase.co/auth/v1/token?grant_type=pkce')).rejects.toThrow('fetch failed')
    expect(network).toHaveBeenCalledTimes(TRIP_AFTER + 3)
  })
})
