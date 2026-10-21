import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const mockRequireUser = vi.fn()
vi.mock('@/lib/api-auth', () => ({ requireUser: () => mockRequireUser(), isAuthFailure: (r: any) => 'error' in r }))
const mockLoad = vi.fn()
vi.mock('@/lib/on-catalog', () => ({ loadOnAnalyses: (...a: unknown[]) => mockLoad(...a) }))
const mockHoldings = vi.fn()
vi.mock('@/lib/on-holdings', () => ({ loadOnHoldings: (...a: unknown[]) => mockHoldings(...a) }))

const { GET } = await import('../route')
beforeEach(() => { mockRequireUser.mockReset(); mockLoad.mockReset(); mockHoldings.mockReset() })

describe('GET /api/ons/mi-cartera', () => {
  it('requires a session', async () => {
    mockRequireUser.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) })
    expect((await GET()).status).toBe(401)
    expect(mockHoldings).not.toHaveBeenCalled()
  })

  it('reads holdings with the user client and returns the analysis, unmapped tickers and catalog status', async () => {
    const supabase = {}
    mockRequireUser.mockResolvedValue({ supabase, user: { id: 'u1' } })
    mockHoldings.mockResolvedValue([{ ticker: 'ZZZZD', quantity: 10 }])
    mockLoad.mockResolvedValue({ analyses: [], asOf: '2026-10-20', stale: false, prices: { ok: true, quiet: false, fetchedAt: null } })
    const res = await GET()
    expect(res.status).toBe(200)
    expect(mockHoldings).toHaveBeenCalledWith(supabase, 'u1')
    const body = await res.json()
    expect(body.unmapped).toEqual([{ ticker: 'ZZZZD', vn: 1000 }])
    expect(body.analysis.empty).toBe(true)
    expect(body).toMatchObject({ asOf: '2026-10-20', stale: false })
  })

  it('a failure is a generic 500 that does not leak the cause', async () => {
    mockRequireUser.mockResolvedValue({ supabase: {}, user: { id: 'u1' } })
    mockHoldings.mockRejectedValue(new Error('on_positions: password=xyz'))
    const res = await GET()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('xyz')
  })
})
