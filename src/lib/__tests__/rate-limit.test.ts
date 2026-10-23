// T5 (odd/tasks/security-hardening.md S5): a fixed-window limiter on Redis
// that fails open when Redis is unavailable.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// In-memory stand-in for the MULTI that rateLimit sends: SET key 0 EX n NX, INCR key.
const counters = new Map<string, number>()
const ttls = new Map<string, number>()
let execFails = false
const fakeRedis = {
  multi: () => {
    const ops: Array<() => [null, unknown]> = []
    const chain = {
      set: (key: string, value: string, _ex: 'EX', seconds: number, _nx: 'NX') => {
        ops.push(() => {
          if (counters.has(key)) return [null, null]
          counters.set(key, Number(value))
          ttls.set(key, seconds)
          return [null, 'OK']
        })
        return chain
      },
      incr: (key: string) => {
        ops.push(() => {
          const next = (counters.get(key) ?? 0) + 1
          counters.set(key, next)
          return [null, next]
        })
        return chain
      },
      exec: async () => {
        if (execFails) throw new Error('OOM command not allowed')
        return ops.map((op) => op())
      },
    }
    return chain
  },
}
const ensureRedisConnected = vi.fn()
vi.mock('@/lib/redis', () => ({
  getRedis: () => fakeRedis,
  ensureRedisConnected: () => ensureRedisConnected(),
}))

import { rateLimit, tooManyRequests, clientIp } from '@/lib/rate-limit'

beforeEach(() => {
  counters.clear()
  ttls.clear()
  execFails = false
  ensureRedisConnected.mockReset().mockResolvedValue(true)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('rateLimit', () => {
  it('allows max hits per window, blocks the next one, and the window expires', async () => {
    const results = []
    for (let i = 0; i < 4; i++) results.push(await rateLimit('rl:test', 3, 60))

    expect(results).toEqual([true, true, true, false])
    expect(ttls.get('rl:test')).toBe(60)
  })

  it('allows the request when Redis is not connected', async () => {
    ensureRedisConnected.mockResolvedValue(false)

    expect(await rateLimit('rl:test', 0, 60)).toBe(true)
    expect(console.warn).toHaveBeenCalled()
  })

  it('allows the request when a Redis command fails', async () => {
    execFails = true

    expect(await rateLimit('rl:test', 0, 60)).toBe(true)
    expect(console.warn).toHaveBeenCalled()
  })
})

describe('tooManyRequests', () => {
  it('answers 429 with Retry-After', async () => {
    const res = tooManyRequests(60)

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    expect((await res.json()).error).toBe('Too many requests')
  })
})

describe('clientIp', () => {
  const req = (headers: Record<string, string>) => new Request('http://localhost/api/activos', { headers })

  it('prefers cf-connecting-ip, then the first x-forwarded-for entry, then unknown', () => {
    expect(clientIp(req({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' }))).toBe('1.1.1.1')
    expect(clientIp(req({ 'x-forwarded-for': ' 2.2.2.2 , 10.0.0.1' }))).toBe('2.2.2.2')
    expect(clientIp(req({}))).toBe('unknown')
  })
})
