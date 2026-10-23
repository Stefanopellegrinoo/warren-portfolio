import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const mockRequireUser = vi.fn()
vi.mock('@/lib/api-auth', () => ({
  requireUser: () => mockRequireUser(),
  isAuthFailure: (r: any) => 'error' in r,
}))
const mockLoad = vi.fn()
const mockHistory = vi.fn()
vi.mock('@/lib/on-catalog', () => ({
  loadOnAnalyses: (...a: unknown[]) => mockLoad(...a),
  loadPriceHistory: (...a: unknown[]) => mockHistory(...a),
}))

const mockRateLimit = vi.fn()
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  rateLimit: (...a: unknown[]) => mockRateLimit(...a),
}))

const { GET } = await import('../route')

const analysis = { row: { isin: 'AR0000000001', tickerD: 'TSTAD' }, detail: { schedule: [] } }
const call = (isin: string) => GET(new Request('http://x/api/ons/' + isin), { params: { isin } })

beforeEach(() => {
  mockRequireUser.mockReset().mockResolvedValue({ supabase: { tag: 'sb' }, user: { id: 'u' } })
  mockLoad.mockReset()
  mockHistory.mockReset()
  mockRateLimit.mockReset().mockResolvedValue(true)
})

describe('GET /api/ons/[isin]', () => {
  it('requires a session', async () => {
    mockRequireUser.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) })
    expect((await call('AR0000000001')).status).toBe(401)
  })

  // T13 (odd/tasks/security-hardening.md S13)
  it('returns 429 once the user is over 60 detail calls per 60 s', async () => {
    mockRateLimit.mockResolvedValue(false)

    const res = await call('AR0000000001')

    expect(mockRateLimit).toHaveBeenCalledWith('rl:ons-detail:u', 60, 60)
    expect(res.status).toBe(429)
    expect(mockLoad).not.toHaveBeenCalled()
  })

  it('rejects a malformed ISIN before touching the database', async () => {
    expect((await call("AR0000000001'; drop")).status).toBe(400)
    expect(mockLoad).not.toHaveBeenCalled()
  })

  it('unknown ISIN is a Spanish 404', async () => {
    mockLoad.mockResolvedValue({ analyses: [], asOf: '2026-10-20', stale: false, prices: { ok: true, fetchedAt: null } })
    const res = await call('AR0000000009')
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/no encontrada/i)
  })

  it('returns the analysis scoped to the ISIN with the D-line history', async () => {
    mockLoad.mockResolvedValue({ analyses: [analysis], asOf: '2026-10-20', stale: false, prices: { ok: true, fetchedAt: 'now' } })
    mockHistory.mockResolvedValue([{ date: '2026-10-20', close: 101 }])
    const res = await call('AR0000000001')
    expect(res.status).toBe(200)
    expect(mockLoad).toHaveBeenCalledWith({ tag: 'sb' }, { isin: 'AR0000000001' })
    expect(mockHistory).toHaveBeenCalledWith({ tag: 'sb' }, 'TSTAD')
    expect(await res.json()).toEqual({ analysis, history: [{ date: '2026-10-20', close: 101 }], asOf: '2026-10-20', stale: false, prices: { ok: true, fetchedAt: 'now' } })
  })

  it('a read failure is a 500 that does not leak the cause', async () => {
    mockLoad.mockRejectedValue(new Error('secret detail'))
    const res = await call('AR0000000001')
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret')
  })
})
