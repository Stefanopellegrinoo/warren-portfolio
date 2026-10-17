import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const mockRequireUser = vi.fn()
vi.mock('@/lib/api-auth', () => ({
  requireUser: () => mockRequireUser(),
  isAuthFailure: (r: any) => 'error' in r,
}))

const mockReconcile = vi.fn()
vi.mock('@/lib/ledger-reconciliation', () => ({
  reconcileLedger: (...a: unknown[]) => mockReconcile(...a),
}))

const { GET } = await import('../route')

const USER = '00000000-0000-4000-8000-000000000001'

describe('GET /api/reconciliation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('401s without a session and never reconciles', async () => {
    mockRequireUser.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) })
    const res = await GET()
    expect(res.status).toBe(401)
    expect(mockReconcile).not.toHaveBeenCalled()
  })

  it('reconciles the session user with the user-scoped client', async () => {
    const supabase = { tag: 'user-scoped' }
    mockRequireUser.mockResolvedValue({ supabase, user: { id: USER } })
    mockReconcile.mockResolvedValue({ ok: false, reasons: ['cash: 1.00 replayed vs 2.00 stored'] })
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false, reasons: ['cash: 1.00 replayed vs 2.00 stored'] })
    expect(mockReconcile).toHaveBeenCalledWith(supabase, USER)
  })

  it('500s when the read fails instead of reporting ok', async () => {
    mockRequireUser.mockResolvedValue({ supabase: {}, user: { id: USER } })
    mockReconcile.mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET()
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/boom/)
  })
})
