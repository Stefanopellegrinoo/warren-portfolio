import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const mockRequireUser = vi.fn()
vi.mock('@/lib/api-auth', () => ({
  requireUser: () => mockRequireUser(),
  isAuthFailure: (r: any) => 'error' in r,
}))
const mockLoad = vi.fn()
vi.mock('@/lib/on-catalog', () => ({ loadOnAnalyses: (...a: unknown[]) => mockLoad(...a) }))

const mockRateLimit = vi.fn()
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  rateLimit: (...a: unknown[]) => mockRateLimit(...a),
}))

const { GET } = await import('../route')

const analysis = { row: { isin: 'AR0000000001', tickerO: 'TSTAO', ytmPct: 6.1 }, detail: { schedule: [{ date: '2027-01-01' }], accrued: 1 } }

beforeEach(() => {
  mockRequireUser.mockReset()
  mockLoad.mockReset()
  mockRateLimit.mockReset().mockResolvedValue(true)
})

describe('GET /api/ons', () => {
  it('requires a session', async () => {
    mockRequireUser.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) })
    expect((await GET()).status).toBe(401)
    expect(mockLoad).not.toHaveBeenCalled()
  })

  // T13 (odd/tasks/security-hardening.md S13): the whole catalog in one response gets a tighter limit.
  it('returns 429 once the user is over 20 catalog calls per 60 s', async () => {
    mockRequireUser.mockResolvedValue({ supabase: {}, user: { id: 'u' } })
    mockRateLimit.mockResolvedValue(false)

    const res = await GET()

    expect(mockRateLimit).toHaveBeenCalledWith('rl:ons-catalog:u', 20, 60)
    expect(res.status).toBe(429)
    expect(mockLoad).not.toHaveBeenCalled()
  })

  it('returns list rows only (no schedule or detail) plus as-of, staleness and price status', async () => {
    mockRequireUser.mockResolvedValue({ supabase: {}, user: { id: 'u' } })
    mockLoad.mockResolvedValue({ analyses: [analysis], asOf: '2026-10-20', stale: false, prices: { ok: true, fetchedAt: '2026-10-21T15:00:00Z' } })
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ rows: [analysis.row], asOf: '2026-10-20', stale: false, prices: { ok: true, fetchedAt: '2026-10-21T15:00:00Z' } })
  })

  it('an empty catalog is a 200 with no rows, not an error', async () => {
    mockRequireUser.mockResolvedValue({ supabase: {}, user: { id: 'u' } })
    mockLoad.mockResolvedValue({ analyses: [], asOf: null, stale: true, prices: { ok: false, fetchedAt: null } })
    const body = await (await GET()).json()
    expect(body.rows).toEqual([])
    expect(body.asOf).toBeNull()
  })

  it('a read failure is a 500 that does not leak the cause', async () => {
    mockRequireUser.mockResolvedValue({ supabase: {}, user: { id: 'u' } })
    mockLoad.mockRejectedValue(new Error('on_terms: connection string xyz'))
    const res = await GET()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('xyz')
  })
})
