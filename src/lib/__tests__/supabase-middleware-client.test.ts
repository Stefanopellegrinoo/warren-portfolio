/**
 * The middleware's Supabase client refreshes sessions through the auth breaker
 * (odd/tasks/supabase-efficiency.md S5): with Supabase down, its refreshes reach the network once.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const options: { global?: { fetch?: typeof fetch } }[] = []
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, o: { global?: { fetch?: typeof fetch } }) => { options.push(o); return {} },
}))

afterEach(() => vi.unstubAllGlobals())

describe('createSupabaseServerClient', () => {
  it('sends session refreshes through the breaker shared by every request', async () => {
    const network = vi.fn(async () => { throw new TypeError('fetch failed') })
    vi.stubGlobal('fetch', network)
    const { createSupabaseServerClient } = await import('../supabase-server')
    const req = new NextRequest('https://app.test/dashboard')
    createSupabaseServerClient(req, NextResponse.next())
    createSupabaseServerClient(req, NextResponse.next())

    const token = 'https://x.supabase.co/auth/v1/token?grant_type=refresh_token'
    const { TRIP_AFTER } = await import('../auth-breaker')
    for (let i = 0; i < TRIP_AFTER; i++) await expect(options[0].global!.fetch!(token)).rejects.toThrow('fetch failed')
    await expect(options[1].global!.fetch!(token)).rejects.toThrow('refresh skipped')
    expect(network).toHaveBeenCalledTimes(TRIP_AFTER)
  })
})
