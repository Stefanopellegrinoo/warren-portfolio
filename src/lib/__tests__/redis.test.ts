import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared mock state — captured between class instantiation and test assertions
let capturedDel: ReturnType<typeof vi.fn>
let capturedScan: ReturnType<typeof vi.fn>
let capturedOn: ReturnType<typeof vi.fn>
let capturedConnect: ReturnType<typeof vi.fn>

vi.mock('ioredis', () => {
  // Must be a class so `new Redis(...)` works
  class MockRedis {
    del: ReturnType<typeof vi.fn>
    scan: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    connect: ReturnType<typeof vi.fn>
    setex: ReturnType<typeof vi.fn>
    get: ReturnType<typeof vi.fn>

    constructor() {
      this.del = vi.fn().mockResolvedValue(1)
      this.scan = vi.fn().mockResolvedValue(['0', []])
      this.connect = vi.fn().mockResolvedValue(undefined)
      this.setex = vi.fn().mockResolvedValue('OK')
      this.get = vi.fn().mockResolvedValue(null)
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

  it('invalidates statistics:combined:{userId}', async () => {
    const { invalidateUserCache } = await setup()
    await invalidateUserCache('u1')

    const delArgs = capturedDel.mock.calls.flatMap((call: unknown[]) => call)
    expect(delArgs).toContain('statistics:combined:u1')
  })

  it('invalidates statistics:ons:{userId}', async () => {
    const { invalidateUserCache } = await setup()
    await invalidateUserCache('u1')

    const delArgs = capturedDel.mock.calls.flatMap((call: unknown[]) => call)
    expect(delArgs).toContain('statistics:ons:u1')
  })

  it('invalidates statistics:{userId}', async () => {
    const { invalidateUserCache } = await setup()
    await invalidateUserCache('u1')

    const delArgs = capturedDel.mock.calls.flatMap((call: unknown[]) => call)
    expect(delArgs).toContain('statistics:u1')
  })

  it('invalidates summary:{userId}', async () => {
    const { invalidateUserCache } = await setup()
    await invalidateUserCache('u1')

    const delArgs = capturedDel.mock.calls.flatMap((call: unknown[]) => call)
    expect(delArgs).toContain('summary:u1')
  })
})
