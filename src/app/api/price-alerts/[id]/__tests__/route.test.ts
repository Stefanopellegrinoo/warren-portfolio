import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock auth ─────────────────────────────────────────────────────────────────
const mockRequireUser = vi.fn()
const mockIsAuthFailure = vi.fn()
vi.mock('@/lib/api-auth', () => ({
  requireUser: mockRequireUser,
  isAuthFailure: mockIsAuthFailure,
}))

// ── Supabase mock ─────────────────────────────────────────────────────────────
const mockFrom = vi.fn()
const mockSupabase = { from: mockFrom }

const fakeUser = { id: 'user-1' }
const ALERT_ID = 'alert-abc-123'

function makeDeleteRequest(id: string) {
  return new NextRequest(`http://localhost/api/price-alerts/${id}`, {
    method: 'DELETE',
  })
}

const fakeAlert = { id: ALERT_ID }

// ── DELETE tests ──────────────────────────────────────────────────────────────

describe('DELETE /api/price-alerts/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ user: fakeUser, supabase: mockSupabase })
    mockIsAuthFailure.mockReturnValue(false)
  })

  it('returns 401 when not authenticated', async () => {
    mockRequireUser.mockResolvedValue({ error: new Response(null, { status: 401 }) })
    mockIsAuthFailure.mockReturnValue(true)

    const { DELETE } = await import('../route')
    const res = await DELETE(makeDeleteRequest(ALERT_ID), { params: { id: ALERT_ID } })
    expect(res.status).toBe(401)
  })

  it('returns 403 when alert does not belong to the user', async () => {
    // Simulate no row found (fetchError or no existing row)
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'No rows' } }),
    })

    const { DELETE } = await import('../route')
    const res = await DELETE(makeDeleteRequest(ALERT_ID), { params: { id: ALERT_ID } })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it('returns 403 when alert exists but belongs to another user', async () => {
    // Ownership check returns null (no matching row for this user)
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })

    const { DELETE } = await import('../route')
    const res = await DELETE(makeDeleteRequest(ALERT_ID), { params: { id: ALERT_ID } })
    expect(res.status).toBe(403)
  })

  it('returns 204 when alert is successfully deleted', async () => {
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // Ownership check
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: fakeAlert, error: null }),
        }
      } else {
        // Delete succeeds
        const inner = {
          eq: vi.fn().mockResolvedValue({ error: null }),
        }
        return {
          delete: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnValue(inner),
        }
      }
    })

    const { DELETE } = await import('../route')
    const res = await DELETE(makeDeleteRequest(ALERT_ID), { params: { id: ALERT_ID } })
    // Route uses 204 No Content for successful deletion
    expect(res.status).toBe(204)
  })

  it('returns 500 when Supabase delete fails', async () => {
    // Track call count to differentiate ownership check from delete call
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // Ownership check: returns the alert
        const chain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: fakeAlert, error: null }),
        }
        return chain
      } else {
        // Delete: returns an error
        const inner = {
          eq: vi.fn().mockResolvedValue({ error: { message: 'DB error' } }),
        }
        const chain = {
          delete: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnValue(inner),
        }
        return chain
      }
    })

    const { DELETE } = await import('../route')
    const res = await DELETE(makeDeleteRequest(ALERT_ID), { params: { id: ALERT_ID } })
    expect(res.status).toBe(500)
  })
})
