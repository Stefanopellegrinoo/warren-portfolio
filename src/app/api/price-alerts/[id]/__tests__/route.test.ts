import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock auth ─────────────────────────────────────────────────────────────────
const mockRequireUser = vi.fn()
const mockIsAuthFailure = vi.fn()
vi.mock('@/lib/api-auth', () => ({
  requireUser: mockRequireUser,
  isAuthFailure: mockIsAuthFailure,
}))

// ── Mock redis ────────────────────────────────────────────────────────────────
const mockInvalidateUserCache = vi.fn()
vi.mock('@/lib/redis', () => ({
  invalidateUserCache: mockInvalidateUserCache,
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

function makePatchRequest(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/price-alerts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

// ── PATCH tests ───────────────────────────────────────────────────────────────

describe('PATCH /api/price-alerts/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ user: fakeUser, supabase: mockSupabase })
    mockIsAuthFailure.mockReturnValue(false)
    mockInvalidateUserCache.mockResolvedValue(undefined)
  })

  function makeChain(result: { data: unknown; error: unknown }) {
    const single = vi.fn().mockResolvedValue(result)
    const select = vi.fn().mockReturnValue({ single })
    const eqUserId = vi.fn().mockReturnValue({ select })
    const eqAlertId = vi.fn().mockReturnValue({ eq: eqUserId })
    const update = vi.fn().mockReturnValue({ eq: eqAlertId })
    return { from: vi.fn().mockReturnValue({ update }) }
  }

  it('returns 200 with updated alert on partial update (value only)', async () => {
    const updatedAlert = { id: ALERT_ID, value: 150.5, operator: 'crosses_above' }
    const chain = makeChain({ data: updatedAlert, error: null })
    mockFrom.mockImplementation(chain.from)

    const { PATCH } = await import('../route')
    const res = await PATCH(makePatchRequest(ALERT_ID, { value: 150.5 }), { params: { id: ALERT_ID } })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.alert).toEqual(updatedAlert)
  })

  it('returns 200 with updated alert on full update (all fields)', async () => {
    const updatedAlert = {
      id: ALERT_ID,
      name: 'My Alert',
      operator: 'crosses_below',
      value: 200,
      channel: 'email',
    }
    const chain = makeChain({ data: updatedAlert, error: null })
    mockFrom.mockImplementation(chain.from)

    const { PATCH } = await import('../route')
    const res = await PATCH(
      makePatchRequest(ALERT_ID, { name: 'My Alert', operator: 'crosses_below', value: 200, channel: 'email' }),
      { params: { id: ALERT_ID } }
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.alert).toEqual(updatedAlert)
  })

  it('returns 404 when alert belongs to a different user', async () => {
    const chain = makeChain({ data: null, error: { message: 'No rows found' } })
    mockFrom.mockImplementation(chain.from)

    const { PATCH } = await import('../route')
    const res = await PATCH(makePatchRequest(ALERT_ID, { value: 100 }), { params: { id: ALERT_ID } })

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it('returns 400 when operator is invalid', async () => {
    const { PATCH } = await import('../route')
    const res = await PATCH(
      makePatchRequest(ALERT_ID, { operator: 'invalid_op' }),
      { params: { id: ALERT_ID } }
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/operator/)
  })
})
