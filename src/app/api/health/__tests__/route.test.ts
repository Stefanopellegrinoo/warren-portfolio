import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Redis mock ────────────────────────────────────────────────────────────────
const mockEnsureRedisConnected = vi.fn()
vi.mock('@/lib/redis', () => ({
  ensureRedisConnected: mockEnsureRedisConnected,
}))

// ── Supabase service client mock ──────────────────────────────────────────────
const mockCreateServiceClient = vi.fn()
vi.mock('@/lib/supabase-server', () => ({
  createServiceClient: mockCreateServiceClient,
}))

function setupSupabaseQuery(result: { data: unknown; error: unknown }) {
  const mockLimit = vi.fn().mockResolvedValue(result)
  const mockSelect = vi.fn().mockReturnValue({ limit: mockLimit })
  const mockFrom = vi.fn().mockReturnValue({ select: mockSelect })
  mockCreateServiceClient.mockReturnValue({ from: mockFrom })
  return { mockFrom, mockSelect, mockLimit }
}

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns 200 with status ok when Redis and Supabase are both healthy', async () => {
    mockEnsureRedisConnected.mockResolvedValue(true)
    setupSupabaseQuery({ data: [{ ticker: 'YMCID' }], error: null })

    const { GET } = await import('../route')
    const res = await GET()

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ status: 'ok', redis: true, supabase: true })
  })

  it('returns 503 with redis false when Redis is down', async () => {
    mockEnsureRedisConnected.mockResolvedValue(false)
    setupSupabaseQuery({ data: [], error: null })

    const { GET } = await import('../route')
    const res = await GET()

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body).toEqual({ status: 'degraded', redis: false, supabase: true })
  })

  it('returns 503 with supabase false when the Supabase query errors', async () => {
    mockEnsureRedisConnected.mockResolvedValue(true)
    setupSupabaseQuery({ data: null, error: { message: 'connection refused' } })

    const { GET } = await import('../route')
    const res = await GET()

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body).toEqual({ status: 'degraded', redis: true, supabase: false })
  })

  it('returns 503 gracefully when the Supabase client throws', async () => {
    mockEnsureRedisConnected.mockResolvedValue(true)
    mockCreateServiceClient.mockImplementation(() => {
      throw new Error('missing env vars')
    })

    const { GET } = await import('../route')
    const res = await GET()

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body).toEqual({ status: 'degraded', redis: true, supabase: false })
  })

  it('returns 503 with both probes false when Redis is down AND Supabase fails', async () => {
    mockEnsureRedisConnected.mockResolvedValue(false)
    setupSupabaseQuery({ data: null, error: { message: 'connection refused' } })

    const { GET } = await import('../route')
    const res = await GET()

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body).toEqual({ status: 'degraded', redis: false, supabase: false })
  })

  it('returns 503 with redis false when the Redis probe rejects (never a 500)', async () => {
    mockEnsureRedisConnected.mockRejectedValue(new Error('ECONNRESET'))
    setupSupabaseQuery({ data: [{ ticker: 'YMCID' }], error: null })

    const { GET } = await import('../route')
    const res = await GET()

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body).toEqual({ status: 'degraded', redis: false, supabase: true })
  })

  it('serves the cached result within the TTL instead of re-probing', async () => {
    // Arrange — first call: everything healthy
    mockEnsureRedisConnected.mockResolvedValue(true)
    setupSupabaseQuery({ data: [{ ticker: 'YMCID' }], error: null })

    const { GET } = await import('../route')
    const first = await GET()
    expect(first.status).toBe(200)

    // Flip the world: Redis is now down. A fresh probe would return 503,
    // but within the 10s TTL the route must serve the cached 200.
    mockEnsureRedisConnected.mockResolvedValue(false)

    // Act
    const second = await GET()

    // Assert — cached result, single probe round
    expect(second.status).toBe(200)
    const body = await second.json()
    expect(body).toEqual({ status: 'ok', redis: true, supabase: true })
    expect(mockEnsureRedisConnected).toHaveBeenCalledTimes(1)
  })
})
