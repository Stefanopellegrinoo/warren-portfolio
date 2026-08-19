import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock ioredis with REAL semantics ─────────────────────────────────────────
// Keys live WITH the warren: prefix; SCAN's MATCH is NOT prefixed by ioredis
// and is evaluated against the full key string.

let capturedDel: ReturnType<typeof vi.fn>
let capturedScan: ReturnType<typeof vi.fn>

vi.mock('ioredis', () => {
  class MockRedis {
    del: ReturnType<typeof vi.fn>
    scan: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    connect: ReturnType<typeof vi.fn>
    setex = vi.fn().mockResolvedValue('OK')
    get = vi.fn().mockResolvedValue(null)
    incr = vi.fn().mockResolvedValue(1)
    expire = vi.fn().mockResolvedValue(1)

    constructor() {
      this.del = vi.fn().mockResolvedValue(1)
      this.scan = vi.fn(async (_cursor: string, _matchKw: string, pattern: string) => {
        const KEYSPACE = ['warren:cash:balance:u1', 'warren:cash:balance:u2']
        const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern
        return ['0', KEYSPACE.filter((k) => k.startsWith(prefix))]
      })
      const handlers: Record<string, () => void> = {}
      this.on = vi.fn((event: string, handler: () => void) => {
        handlers[event] = handler
      })
      this.connect = vi.fn(async () => {
        if (handlers['connect']) handlers['connect']()
      })
      capturedDel = this.del
      capturedScan = this.scan
    }
  }
  return { default: MockRedis }
})

describe('invalidateCache (cache.ts)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  async function setup() {
    const redisModule = await import('../redis')
    redisModule.getRedis()
    await new Promise((resolve) => setTimeout(resolve, 0))
    return import('../cache')
  }

  it('prefixes the MATCH pattern and strips the prefix before DEL', async () => {
    // Before the fix: MATCH `cash:balance:*` matched nothing against keys
    // stored as `warren:cash:balance:*` AND the results (had any existed)
    // were passed back to DEL unstripped → warren:warren:… double prefix.
    const { invalidateCache } = await setup()

    await invalidateCache('cash:balance:*')

    const patterns = capturedScan.mock.calls.map((call: unknown[]) => call[2])
    expect(patterns).toContain('warren:cash:balance:*')

    const delArgs = capturedDel.mock.calls.flatMap((call: unknown[]) => call)
    expect(delArgs).toContain('cash:balance:u1')
    expect(delArgs).toContain('cash:balance:u2')
    expect(delArgs.some((k: unknown) => String(k).startsWith('warren:'))).toBe(false)
  })
})
