import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock auth ─────────────────────────────────────────────────────────────────
const mockRequireUser = vi.fn()
const mockIsAuthFailure = vi.fn()
vi.mock('@/lib/api-auth', () => ({
  requireUser: mockRequireUser,
  isAuthFailure: mockIsAuthFailure,
}))

// ── Mock redis ────────────────────────────────────────────────────────────────
const mockGetRedis = vi.fn()
const mockEnsureRedisConnected = vi.fn()
vi.mock('@/lib/redis', () => ({
  getRedis: mockGetRedis,
  ensureRedisConnected: mockEnsureRedisConnected,
}))

// ── Mock signals queue ────────────────────────────────────────────────────────
const mockEnqueueImmediateEvaluation = vi.fn()
vi.mock('@/lib/signals-queue', () => ({
  enqueueImmediateEvaluation: mockEnqueueImmediateEvaluation,
}))

const fakeUser = { id: 'user-1' }

function setupAuth() {
  mockRequireUser.mockResolvedValue({ user: fakeUser })
  mockIsAuthFailure.mockReturnValue(false)
}

describe('POST /api/trigger-evaluation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupAuth()
    vi.resetModules()
  })

  it('returns 202 and enqueues evaluation when Redis is ready and rate limit passes', async () => {
    // Arrange
    mockEnsureRedisConnected.mockResolvedValue(true)
    mockGetRedis.mockReturnValue({ set: vi.fn().mockResolvedValue('OK') })
    mockEnqueueImmediateEvaluation.mockResolvedValue(undefined)

    // Act
    const { POST } = await import('../route')
    const res = await POST()

    // Assert
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.queued).toBe(true)
    expect(mockEnqueueImmediateEvaluation).toHaveBeenCalledTimes(1)
    expect(mockEnqueueImmediateEvaluation).toHaveBeenCalledWith('user-1')
  })

  it('returns 503 and does NOT enqueue when Redis is not reachable', async () => {
    // Arrange
    mockEnsureRedisConnected.mockResolvedValue(false)
    mockGetRedis.mockReturnValue(null)

    // Act
    const { POST } = await import('../route')
    const res = await POST()

    // Assert
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toMatch(/temporarily unavailable/i)
    expect(mockEnqueueImmediateEvaluation).not.toHaveBeenCalled()
  })

  it('returns 429 and does NOT enqueue when rate limit key already exists', async () => {
    // Arrange
    mockEnsureRedisConnected.mockResolvedValue(true)
    // SET NX returns null (not 'OK') when the key already exists
    mockGetRedis.mockReturnValue({ set: vi.fn().mockResolvedValue(null) })

    // Act
    const { POST } = await import('../route')
    const res = await POST()

    // Assert
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toMatch(/rate limit/i)
    expect(mockEnqueueImmediateEvaluation).not.toHaveBeenCalled()
  })

  it('skips rate limiting and returns 202 when getRedis returns null but Redis is connectable', async () => {
    // Arrange — no REDIS_URL client, but the connection guard succeeds
    mockGetRedis.mockReturnValue(null)
    mockEnsureRedisConnected.mockResolvedValue(true)
    mockEnqueueImmediateEvaluation.mockResolvedValue(undefined)

    // Act
    const { POST } = await import('../route')
    const res = await POST()

    // Assert — rate-limit block skipped entirely, evaluation still queued
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.queued).toBe(true)
    expect(mockEnqueueImmediateEvaluation).toHaveBeenCalledWith('user-1')
  })

  it('proceeds to 202 when the rate-limit set call rejects (graceful degradation)', async () => {
    // Arrange — redis.set throws; the catch must swallow it and continue
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mockSet = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    mockGetRedis.mockReturnValue({ set: mockSet })
    mockEnsureRedisConnected.mockResolvedValue(true)
    mockEnqueueImmediateEvaluation.mockResolvedValue(undefined)

    // Act — must not surface an unhandled rejection
    const { POST } = await import('../route')
    const res = await POST()

    // Assert
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.queued).toBe(true)
    expect(mockSet).toHaveBeenCalledTimes(1)
    expect(mockEnqueueImmediateEvaluation).toHaveBeenCalledWith('user-1')
    warnSpy.mockRestore()
  })

  it('returns 503 when the rate-limit set call rejects AND Redis is unreachable', async () => {
    // Arrange — set rejects, then the connection guard fails
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockGetRedis.mockReturnValue({ set: vi.fn().mockRejectedValue(new Error('ECONNRESET')) })
    mockEnsureRedisConnected.mockResolvedValue(false)

    // Act
    const { POST } = await import('../route')
    const res = await POST()

    // Assert — execution reached the ensureRedisConnected guard
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toMatch(/temporarily unavailable/i)
    expect(mockEnqueueImmediateEvaluation).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
