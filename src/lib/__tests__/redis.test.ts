import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared mock state — captured between class instantiation and test assertions
let capturedDel: ReturnType<typeof vi.fn>
let capturedScan: ReturnType<typeof vi.fn>
let capturedOn: ReturnType<typeof vi.fn>
let capturedConnect: ReturnType<typeof vi.fn>
let capturedIncr: ReturnType<typeof vi.fn>
let capturedExpire: ReturnType<typeof vi.fn>
let capturedGet: ReturnType<typeof vi.fn>

vi.mock('ioredis', () => {
  // Must be a class so `new Redis(...)` works
  class MockRedis {
    del: ReturnType<typeof vi.fn>
    scan: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    connect: ReturnType<typeof vi.fn>
    setex: ReturnType<typeof vi.fn>
    get: ReturnType<typeof vi.fn>
    incr: ReturnType<typeof vi.fn>
    expire: ReturnType<typeof vi.fn>

    constructor() {
      this.del = vi.fn().mockResolvedValue(1)
      // Simulate REAL Redis semantics: keys live WITH the warren: prefix
      // (ioredis prefixes SETEX/DEL args but NOT the SCAN MATCH pattern),
      // and MATCH is evaluated against the FULL key string.
      this.scan = vi.fn(async (_cursor: string, _matchKw: string, pattern: string) => {
        const KEYSPACE = [
          'warren:history:v3:u1:90',
          'warren:history:v3:u1:all',
          'warren:statistics:v4:u1:measurable',
          'warren:statistics:v4:u1:stocks',
        ]
        const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern
        return ['0', KEYSPACE.filter((k) => k.startsWith(prefix))]
      })
      this.connect = vi.fn().mockResolvedValue(undefined)
      this.setex = vi.fn().mockResolvedValue('OK')
      this.get = vi.fn().mockResolvedValue(null)
      this.incr = vi.fn().mockResolvedValue(1)
      this.expire = vi.fn().mockResolvedValue(1)
      // `on` captures event handlers so tests can fire 'connect'
      const handlers: Record<string, () => void> = {}
      this.on = vi.fn((event: string, handler: () => void) => {
        handlers[event] = handler
      })
      // Expose to outer scope for the test to use
      capturedDel = this.del
      capturedScan = this.scan
      capturedOn = this.on
      capturedConnect = this.connect
      capturedIncr = this.incr
      capturedExpire = this.expire
      capturedGet = this.get
      // Automatically fire the 'connect' event once connect() resolves
      this.connect = vi.fn(async () => {
        if (handlers['connect']) handlers['connect']()
      })
    }
  }

  return { default: MockRedis }
})

describe('invalidateUserCache', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  async function setup() {
    const redisModule = await import('../redis')
    // Trigger lazy initialization
    redisModule.getRedis()
    // Wait for the async connect to fire the 'connect' event
    await new Promise((resolve) => setTimeout(resolve, 0))
    return redisModule
  }

  it('every user write moves the shared ledger version, which never expires (the worker reuses its reads until it moves)', async () => {
    const { invalidateUserCache } = await setup()
    await invalidateUserCache('u1')

    expect(capturedIncr).toHaveBeenCalledWith('ledger:version')
    expect(capturedExpire.mock.calls.map((c: unknown[]) => c[0])).not.toContain('ledger:version')
  })

  it('invalidates statistics:combined:{userId}', async () => {
    const { invalidateUserCache } = await setup()
    await invalidateUserCache('u1')

    const delArgs = capturedDel.mock.calls.flatMap((call: unknown[]) => call)
    expect(delArgs).toContain('statistics:combined:u1')
  })

  it('invalidates statistics:ons:v3:{userId}', async () => {
    const { invalidateUserCache } = await setup()
    await invalidateUserCache('u1')

    const delArgs = capturedDel.mock.calls.flatMap((call: unknown[]) => call)
    expect(delArgs).toContain('statistics:ons:v3:u1')
    expect(delArgs).not.toContain('statistics:ons:v2:u1')
  })

  it('invalidates statistics:v4:{userId}:* via SCAN — one cache entry per universe', async () => {
    const { invalidateUserCache } = await setup()
    await invalidateUserCache('u1')

    const delArgs = capturedDel.mock.calls.flatMap((call: unknown[]) => call)
    expect(delArgs).toContain('statistics:v4:u1:measurable')
    expect(delArgs).toContain('statistics:v4:u1:stocks')
  })

  it('invalidates derived:v1:{userId}', async () => {
    const { invalidateUserCache } = await setup()
    await invalidateUserCache('u1')

    const delArgs = capturedDel.mock.calls.flatMap((call: unknown[]) => call)
    expect(delArgs).toContain('derived:v1:u1')
  })

  it('invalidates summary:{userId}', async () => {
    const { invalidateUserCache } = await setup()
    await invalidateUserCache('u1')

    const delArgs = capturedDel.mock.calls.flatMap((call: unknown[]) => call)
    expect(delArgs).toContain('summary:u1')
  })

  it('scans with the warren: prefix in MATCH — ioredis does not prefix it', async () => {
    // Before the fix the pattern was `history:u1:*`, which matches NOTHING
    // against keys stored as `warren:history:u1:*` — a silent no-op that left
    // the evolution chart serving stale data for its full TTL. The pattern is
    // now versioned (`history:v3:{userId}:*` and `statistics:v4:{userId}:*`)
    // so a stale prior-shape payload can never serve past a shape change.
    const { invalidateUserCache } = await setup()
    await invalidateUserCache('u1')

    const patterns = capturedScan.mock.calls.map((call: unknown[]) => call[2])
    expect(patterns).toContain('warren:history:v3:u1:*')
    expect(patterns).toContain('warren:statistics:v4:u1:*')
    expect(patterns).not.toContain('warren:statistics:v3:u1:*')
  })

  it('deletes scanned keys with the prefix STRIPPED (DEL re-adds it)', async () => {
    const { invalidateUserCache } = await setup()
    await invalidateUserCache('u1')

    const delArgs = capturedDel.mock.calls.flatMap((call: unknown[]) => call)
    expect(delArgs).toContain('history:v3:u1:90')
    expect(delArgs).toContain('history:v3:u1:all')
    expect(delArgs).toContain('statistics:v4:u1:measurable')
    expect(delArgs).toContain('statistics:v4:u1:stocks')
    // Never the double-prefix form
    expect(delArgs.some((k: unknown) => String(k).startsWith('warren:'))).toBe(false)
  })

  it('increments summary version before deleting summary:{userId}', async () => {
    const { invalidateUserCache } = await setup()
    await invalidateUserCache('u1')

    const incrArgs = capturedIncr.mock.calls.flatMap((call: unknown[]) => call)
    expect(incrArgs).toContain('summary:version:u1')
  })

  it('sets summary version TTL before deleting summary:{userId}', async () => {
    const { invalidateUserCache } = await setup()
    await invalidateUserCache('u1')

    const expireArgs = capturedExpire.mock.calls
    const matching = expireArgs.find((call) => call[0] === 'summary:version:u1' && call[1] === 1200)
    expect(matching).toBeDefined()
  })
})

describe('summary TTL constants', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('keeps the version-key TTL strictly longer than the payload TTL', async () => {
    // Invariant: the CAS version guard must always outlive the cached payload,
    // otherwise both can expire mid-computation and a stale write slips past.
    const { SUMMARY_CACHE_TTL, SUMMARY_VERSION_TTL } = await import('../redis')

    expect(SUMMARY_VERSION_TTL).toBeGreaterThan(SUMMARY_CACHE_TTL)
  })
})

describe('readLedgerVersion', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('reads the version: "0" before any write, the stored value after', async () => {
    const redisModule = await import('../redis')
    redisModule.getRedis()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(await redisModule.readLedgerVersion()).toBe('0')
    capturedGet.mockResolvedValueOnce('12')
    expect(await redisModule.readLedgerVersion()).toBe('12')
    expect(capturedGet).toHaveBeenCalledWith('ledger:version')
  })

  it('is null when Redis cannot say, so the caller reads everything again', async () => {
    const redisModule = await import('../redis')
    expect(await redisModule.readLedgerVersion()).toBeNull()

    redisModule.getRedis()
    await new Promise((resolve) => setTimeout(resolve, 0))
    capturedGet.mockRejectedValueOnce(new Error('down'))
    expect(await redisModule.readLedgerVersion()).toBeNull()
  })
})

describe('alerts version', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('creating, editing, deleting or firing an alert moves it; the worker reads it back', async () => {
    const redisModule = await import('../redis')
    redisModule.getRedis()
    await new Promise((resolve) => setTimeout(resolve, 0))

    await redisModule.bumpAlertsVersion()
    expect(capturedIncr).toHaveBeenCalledWith('alerts:version')
    capturedGet.mockResolvedValueOnce('5')
    expect(await redisModule.readAlertsVersion()).toBe('5')
  })

  it('a bump without Redis changes nothing and never throws', async () => {
    const redisModule = await import('../redis')
    await expect(redisModule.bumpAlertsVersion()).resolves.toBeUndefined()
    expect(await redisModule.readAlertsVersion()).toBeNull()
  })
})
