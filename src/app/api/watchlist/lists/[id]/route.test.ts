import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock auth ─────────────────────────────────────────────────────────────────
const mockRequireUser = vi.fn()
const mockIsAuthFailure = vi.fn()
vi.mock('@/lib/api-auth', () => ({
  requireUser: mockRequireUser,
  isAuthFailure: mockIsAuthFailure,
}))

// ── Supabase mock (injected via requireUser result) ───────────────────────────
const mockFrom = vi.fn()
const mockSupabase = { from: mockFrom }

// ── Helpers ───────────────────────────────────────────────────────────────────
function makePatchRequest(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/watchlist/lists/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeDeleteRequest(id: string) {
  return new NextRequest(`http://localhost/api/watchlist/lists/${id}`, {
    method: 'DELETE',
  })
}

const fakeUser = { id: 'user-1' }
const fakeParams = { id: 'list-1' }

describe('PATCH /api/watchlist/lists/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ user: fakeUser, supabase: mockSupabase })
    mockIsAuthFailure.mockReturnValue(false)
  })

  it('returns 401 when not authenticated', async () => {
    mockRequireUser.mockResolvedValue({ error: new Response(null, { status: 401 }) })
    mockIsAuthFailure.mockReturnValue(true)

    const { PATCH } = await import('./route')
    const res = await PATCH(makePatchRequest('list-1', { name: 'New Name' }), { params: fakeParams })
    expect(res.status).toBe(401)
  })

  it('returns 422 when name is empty', async () => {
    const { PATCH } = await import('./route')
    const res = await PATCH(makePatchRequest('list-1', { name: '' }), { params: fakeParams })
    expect(res.status).toBe(422)

    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it('returns 422 when name is longer than 50 characters', async () => {
    const { PATCH } = await import('./route')
    const res = await PATCH(makePatchRequest('list-1', { name: 'A'.repeat(51) }), { params: fakeParams })
    expect(res.status).toBe(422)
  })

  it('returns 404 when list does not exist or is not owned by user', async () => {
    const updateChain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'Row not found' } }),
    }
    mockFrom.mockReturnValue(updateChain)

    const { PATCH } = await import('./route')
    const res = await PATCH(makePatchRequest('list-999', { name: 'Renamed' }), { params: { id: 'list-999' } })
    expect(res.status).toBe(404)
  })

  it('returns 200 with renamed list on success', async () => {
    const updateChain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'list-1', name: 'BCBA Stocks', created_at: '2026-01-01T00:00:00Z' },
        error: null,
      }),
    }
    mockFrom.mockReturnValue(updateChain)

    const { PATCH } = await import('./route')
    const res = await PATCH(makePatchRequest('list-1', { name: 'BCBA Stocks' }), { params: fakeParams })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.id).toBe('list-1')
    expect(body.name).toBe('BCBA Stocks')
  })
})

describe('DELETE /api/watchlist/lists/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ user: fakeUser, supabase: mockSupabase })
    mockIsAuthFailure.mockReturnValue(false)
  })

  it('returns 401 when not authenticated', async () => {
    mockRequireUser.mockResolvedValue({ error: new Response(null, { status: 401 }) })
    mockIsAuthFailure.mockReturnValue(true)

    const { DELETE } = await import('./route')
    const res = await DELETE(makeDeleteRequest('list-1'), { params: fakeParams })
    expect(res.status).toBe(401)
  })

  it('returns 404 when list does not exist or is not owned by user', async () => {
    // Count check: returns empty (not found for this user)
    const selectChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'Row not found' } }),
    }
    mockFrom.mockReturnValue(selectChain)

    const { DELETE } = await import('./route')
    const res = await DELETE(makeDeleteRequest('list-999'), { params: { id: 'list-999' } })
    expect(res.status).toBe(404)
  })

  it('returns 422 when attempting to delete the last list', async () => {
    // Ownership check: returns the list (owned)
    const selectSingleChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'list-1', user_id: 'user-1', name: 'My List' },
        error: null,
      }),
    }
    // Count check: returns 1 (only list)
    const countChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [{ id: 'list-1' }],
        error: null,
      }),
    }
    mockFrom
      .mockReturnValueOnce(selectSingleChain)
      .mockReturnValueOnce(countChain)

    const { DELETE } = await import('./route')
    const res = await DELETE(makeDeleteRequest('list-1'), { params: fakeParams })
    expect(res.status).toBe(422)

    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it('returns 200 and deletes list when user has more than one list', async () => {
    // Ownership check: returns the list (owned)
    const selectSingleChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'list-1', user_id: 'user-1', name: 'Tech US' },
        error: null,
      }),
    }
    // Count check: returns 2 lists
    const countChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [{ id: 'list-1' }, { id: 'list-2' }],
        error: null,
      }),
    }
    // Delete chain — supports .delete().eq('id').eq('user_id') which resolves
    const deleteChain = {
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    }

    mockFrom
      .mockReturnValueOnce(selectSingleChain)
      .mockReturnValueOnce(countChain)
      .mockReturnValueOnce(deleteChain)

    const { DELETE } = await import('./route')
    const res = await DELETE(makeDeleteRequest('list-1'), { params: fakeParams })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.success).toBe(true)
  })
})
