import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Redis mock ────────────────────────────────────────────────────────────────
const mockEnsureRedisConnected = vi.fn()
vi.mock('@/lib/redis', () => ({
  ensureRedisConnected: mockEnsureRedisConnected,
}))

// ── Heartbeat mock ────────────────────────────────────────────────────────────
const mockReadBeat = vi.fn()
vi.mock('@/lib/job-health', () => ({ readBeat: mockReadBeat }))
const FRESH = { lastBeat: '2026-01-01T00:00:00.000Z', stale: false }

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
    mockReadBeat.mockResolvedValue(FRESH)
  })

  it('returns 200 with status ok when Redis and Supabase are both healthy', async () => {
    mockEnsureRedisConnected.mockResolvedValue(true)
    setupSupabaseQuery({ data: [{ ticker: 'YMCID' }], error: null })

    const { GET } = await import('../route')
    const res = await GET()

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ status: 'ok', redis: true, supabase: true, worker: FRESH })
  })

  it('returns 503 with redis false when Redis is down', async () => {
    mockEnsureRedisConnected.mockResolvedValue(false)
    setupSupabaseQuery({ data: [], error: null })

    const { GET } = await import('../route')
    const res = await GET()

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body).toEqual({ status: 'degraded', redis: false, supabase: true, worker: FRESH })
  })

  it('returns 503 with supabase false when the Supabase query errors', async () => {
    mockEnsureRedisConnected.mockResolvedValue(true)
    setupSupabaseQuery({ data: null, error: { message: 'connection refused' } })

    const { GET } = await import('../route')
    const res = await GET()

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body).toEqual({ status: 'degraded', redis: true, supabase: false, worker: FRESH })
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
    expect(body).toEqual({ status: 'degraded', redis: true, supabase: false, worker: FRESH })
  })

  it('returns 503 with both probes false when Redis is down AND Supabase fails', async () => {
    mockEnsureRedisConnected.mockResolvedValue(false)
    setupSupabaseQuery({ data: null, error: { message: 'connection refused' } })

    const { GET } = await import('../route')
    const res = await GET()

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body).toEqual({ status: 'degraded', redis: false, supabase: false, worker: FRESH })
  })

  it('returns 503 with redis false when the Redis probe rejects (never a 500)', async () => {
    mockEnsureRedisConnected.mockRejectedValue(new Error('ECONNRESET'))
    setupSupabaseQuery({ data: [{ ticker: 'YMCID' }], error: null })

    const { GET } = await import('../route')
    const res = await GET()

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body).toEqual({ status: 'degraded', redis: false, supabase: true, worker: FRESH })
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
    expect(body).toEqual({ status: 'ok', redis: true, supabase: true, worker: FRESH })
    expect(mockEnsureRedisConnected).toHaveBeenCalledTimes(1)
  })

  it('reports a stale worker in the body without changing the status code', async () => {
    mockEnsureRedisConnected.mockResolvedValue(true)
    setupSupabaseQuery({ data: [{ ticker: 'YMCID' }], error: null })
    mockReadBeat.mockResolvedValue({ lastBeat: null, stale: true })

    const { GET } = await import('../route')
    const res = await GET()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      status: 'ok', redis: true, supabase: true, worker: { lastBeat: null, stale: true },
    })
  })

  it('answers 503 for Redis down with the heartbeat stale too', async () => {
    mockEnsureRedisConnected.mockResolvedValue(false)
    setupSupabaseQuery({ data: [], error: null })
    mockReadBeat.mockResolvedValue({ lastBeat: null, stale: true })

    const { GET } = await import('../route')
    const res = await GET()

    expect(res.status).toBe(503)
    expect((await res.json()).worker).toEqual({ lastBeat: null, stale: true })
  })

  describe('ON terms freshness (informational)', () => {
    // Table-aware client: `ons` answers the probe, `on_terms` answers the freshness read.
    function setup(onTerms: { data: unknown; error: unknown } | 'throw') {
      mockCreateServiceClient.mockReturnValue({
        from: (table: string) => ({
          select: () =>
            table === 'ons'
              ? { limit: () => Promise.resolve({ data: [{ ticker: 'X' }], error: null }) }
              : onTerms === 'throw'
                ? (() => { throw new Error('boom') })()
                : { order: () => ({ limit: () => Promise.resolve(onTerms) }) },
        }),
      })
    }

    it('reports the latest as_of without touching the status', async () => {
      mockEnsureRedisConnected.mockResolvedValue(true)
      setup({ data: [{ as_of: '2000-01-03' }], error: null })
      const { GET } = await import('../route')
      const res = await GET()
      expect(res.status).toBe(200)
      expect((await res.json()).onTerms).toEqual({ asOf: '2000-01-03', stale: true })
    })

    it('a failing on_terms read never degrades the probe', async () => {
      mockEnsureRedisConnected.mockResolvedValue(true)
      setup('throw')
      const { GET } = await import('../route')
      const res = await GET()
      expect(res.status).toBe(200)
      expect((await res.json()).status).toBe('ok')
    })

    it('empty on_terms is stale but the status stays driven by Redis and Supabase only', async () => {
      mockEnsureRedisConnected.mockResolvedValue(true)
      setup({ data: [], error: null })
      const { GET } = await import('../route')
      const res = await GET()
      expect(res.status).toBe(200)
      expect((await res.json()).onTerms).toEqual({ asOf: null, stale: true })
    })
  })
})
