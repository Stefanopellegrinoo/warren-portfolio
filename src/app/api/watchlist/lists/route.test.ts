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
function makeGetRequest() {
  return new NextRequest('http://localhost/api/watchlist/lists', { method: 'GET' })
}

function makePostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/watchlist/lists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const fakeUser = { id: 'user-1' }
const fakeUser2 = { id: 'user-2' }

const fakeList1 = { id: 'list-1', user_id: 'user-1', name: 'Tech US', created_at: '2026-01-01T00:00:00Z', watchlist_items: [{ count: 2 }] }
const fakeList2 = { id: 'list-2', user_id: 'user-1', name: 'BCBA', created_at: '2026-01-02T00:00:00Z', watchlist_items: [{ count: 0 }] }

// ── Build chainable Supabase select mock ──────────────────────────────────────
function buildSelectChain(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error }),
  }
}

function buildCountChain(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error }),
  }
}

describe('GET /api/watchlist/lists', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ user: fakeUser, supabase: mockSupabase })
    mockIsAuthFailure.mockReturnValue(false)
  })

  it('returns 401 when not authenticated', async () => {
    mockRequireUser.mockResolvedValue({ error: new Response(null, { status: 401 }) })
    mockIsAuthFailure.mockReturnValue(true)

    const { GET } = await import('./route')
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(401)
  })

  it('returns { lists: [] } when user has no watchlists', async () => {
    mockFrom.mockReturnValue(buildSelectChain([], null))

    const { GET } = await import('./route')
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.lists).toEqual([])
  })

  it('returns lists with correct item_count', async () => {
    mockFrom.mockReturnValue(buildSelectChain([fakeList1, fakeList2], null))

    const { GET } = await import('./route')
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.lists).toHaveLength(2)
    expect(body.lists[0].id).toBe('list-1')
    expect(body.lists[0].name).toBe('Tech US')
    expect(body.lists[0].item_count).toBe(2)
    expect(body.lists[1].id).toBe('list-2')
    expect(body.lists[1].item_count).toBe(0)
  })

  it('only returns lists belonging to the authenticated user (RLS isolation)', async () => {
    // Simulate RLS: user-2 only sees their own list
    mockRequireUser.mockResolvedValue({ user: fakeUser2, supabase: mockSupabase })
    const user2List = { id: 'list-3', user_id: 'user-2', name: 'Crypto', created_at: '2026-01-03T00:00:00Z', watchlist_items: [{ count: 1 }] }
    mockFrom.mockReturnValue(buildSelectChain([user2List], null))

    const { GET } = await import('./route')
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.lists).toHaveLength(1)
    expect(body.lists[0].id).toBe('list-3')
  })
})

describe('POST /api/watchlist/lists', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ user: fakeUser, supabase: mockSupabase })
    mockIsAuthFailure.mockReturnValue(false)
  })

  it('returns 401 when not authenticated', async () => {
    mockRequireUser.mockResolvedValue({ error: new Response(null, { status: 401 }) })
    mockIsAuthFailure.mockReturnValue(true)

    const { POST } = await import('./route')
    const res = await POST(makePostRequest({ name: 'Tech US' }))
    expect(res.status).toBe(401)
  })

  it('returns 422 when name is empty', async () => {
    const { POST } = await import('./route')
    const res = await POST(makePostRequest({ name: '' }))
    expect(res.status).toBe(422)

    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it('returns 422 when name is longer than 50 characters', async () => {
    const { POST } = await import('./route')
    const res = await POST(makePostRequest({ name: 'A'.repeat(51) }))
    expect(res.status).toBe(422)

    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it('returns 422 when name is missing from body', async () => {
    const { POST } = await import('./route')
    const res = await POST(makePostRequest({}))
    expect(res.status).toBe(422)
  })

  it('returns 422 when user already has 10 watchlists (cap reached)', async () => {
    // First call to from('watchlists') for count check returns 10 lists
    const countChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: Array.from({ length: 10 }, (_, i) => ({ id: `list-${i}` })),
        error: null,
      }),
    }
    mockFrom.mockReturnValue(countChain)

    const { POST } = await import('./route')
    const res = await POST(makePostRequest({ name: 'New List' }))
    expect(res.status).toBe(422)

    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it('returns 201 with created list when name is valid', async () => {
    // First call: count existing lists (below cap)
    const countChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [{ id: 'list-1' }],
        error: null,
      }),
    }
    // Second call: insert new list
    const insertChain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'new-list-id', user_id: 'user-1', name: 'Tech US', created_at: '2026-01-01T00:00:00Z' },
        error: null,
      }),
    }
    mockFrom
      .mockReturnValueOnce(countChain)
      .mockReturnValueOnce(insertChain)

    const { POST } = await import('./route')
    const res = await POST(makePostRequest({ name: 'Tech US' }))
    expect(res.status).toBe(201)

    const body = await res.json()
    expect(body.id).toBe('new-list-id')
    expect(body.name).toBe('Tech US')
    expect(body.item_count).toBe(0)
  })
})
