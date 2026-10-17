import { describe, it, expect, vi, beforeEach } from 'vitest'

const redis = { setex: vi.fn(), set: vi.fn(), get: vi.fn() }
const { mockGetRedis, mockSendTelegram } = vi.hoisted(() => ({ mockGetRedis: vi.fn(), mockSendTelegram: vi.fn() }))
vi.mock('../redis', () => ({ getRedis: mockGetRedis }))
vi.mock('../notifications', async () => {
  const actual = await vi.importActual<typeof import('../notifications')>('../notifications')
  return { ...actual, sendTelegram: mockSendTelegram }
})

import { beat, readBeat, alertJobFailure, recordRefresh, HEARTBEAT_TTL_S } from '../job-health'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetRedis.mockReturnValue(redis)
  redis.setex.mockResolvedValue('OK')
  redis.set.mockResolvedValue('OK')
  mockSendTelegram.mockResolvedValue({ ok: true })
})

describe('beat', () => {
  it('writes heartbeat:worker with a 900s TTL via setex', async () => {
    await beat()
    expect(HEARTBEAT_TTL_S).toBe(900)
    expect(redis.setex).toHaveBeenCalledWith('heartbeat:worker', 900, expect.any(String))
  })

  it('never throws when Redis rejects or is unavailable', async () => {
    redis.setex.mockRejectedValue(new Error('down'))
    await expect(beat()).resolves.toBeUndefined()
    mockGetRedis.mockReturnValue(null)
    await expect(beat()).resolves.toBeUndefined()
  })
})

describe('readBeat', () => {
  it('reports lastBeat and not stale when the key exists', async () => {
    redis.get.mockResolvedValue('2026-01-01T00:00:00.000Z')
    expect(await readBeat()).toEqual({ lastBeat: '2026-01-01T00:00:00.000Z', stale: false })
  })

  it('reports stale when the key is absent', async () => {
    redis.get.mockResolvedValue(null)
    expect(await readBeat()).toEqual({ lastBeat: null, stale: true })
  })

  it('reports stale instead of throwing when Redis fails', async () => {
    redis.get.mockRejectedValue(new Error('down'))
    expect(await readBeat()).toEqual({ lastBeat: null, stale: true })
  })
})

describe('alertJobFailure', () => {
  it('dedupes with SET NX EX 3600 and sends an escaped message', async () => {
    redis.set.mockResolvedValue('OK')
    await alertJobFailure('price', 'refresh', new Error('<html>a & b</html>'))
    expect(redis.set).toHaveBeenCalledWith('alert:job-failed:price:refresh', '1', 'EX', 3600, 'NX')
    const msg = mockSendTelegram.mock.calls[0][0] as string
    expect(msg).toContain('price')
    expect(msg).toContain('&lt;html&gt;a &amp; b&lt;/html&gt;')
    expect(msg).not.toContain('<html>')
  })

  it('does not send when the dedupe key already exists', async () => {
    redis.set.mockResolvedValue(null)
    await alertJobFailure('price', 'refresh', new Error('x'))
    expect(mockSendTelegram).not.toHaveBeenCalled()
  })

  it('never throws when Telegram rejects, reports not-ok, or Redis fails', async () => {
    mockSendTelegram.mockRejectedValue(new Error('net'))
    await expect(alertJobFailure('a', 'b', 'boom')).resolves.toBeUndefined()
    mockSendTelegram.mockResolvedValue({ ok: false, error: 'x' })
    await expect(alertJobFailure('a', 'b', 'boom')).resolves.toBeUndefined()
    redis.set.mockRejectedValue(new Error('down'))
    await expect(alertJobFailure('a', 'b', 'boom')).resolves.toBeUndefined()
  })

  it('still alerts (no dedupe) when Redis is unavailable', async () => {
    mockGetRedis.mockReturnValue(null)
    await alertJobFailure('a', 'b', 'boom')
    expect(mockSendTelegram).toHaveBeenCalledTimes(1)
  })

  it('writes nothing without an expiry', async () => {
    await beat()
    await alertJobFailure('a', 'b', 'boom')
    expect(redis.set.mock.calls.every(c => c.includes('EX'))).toBe(true)
    expect(redis.setex.mock.calls.every(c => typeof c[1] === 'number' && c[1] > 0)).toBe(true)
  })
})

describe('recordRefresh', () => {
  it('writes system:last-refresh with a positive TTL, never a bare set', async () => {
    await recordRefresh()
    expect(redis.setex).toHaveBeenCalledWith('system:last-refresh', expect.any(Number), expect.any(String))
    expect(redis.setex.mock.calls[0][1]).toBeGreaterThan(0)
    expect(redis.set).not.toHaveBeenCalled()
  })

  it('never throws when Redis fails', async () => {
    redis.setex.mockRejectedValue(new Error('down'))
    await expect(recordRefresh()).resolves.toBeUndefined()
  })
})
