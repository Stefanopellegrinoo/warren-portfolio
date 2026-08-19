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

const fakeUser = { id: 'user-1' }

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeGetRequest() {
  return new NextRequest('http://localhost/api/price-alerts', { method: 'GET' })
}

function makePostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/price-alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const fakeAlert = {
  id: 'alert-1',
  user_id: 'user-1',
  ticker: 'AAPL',
  type: 'price',
  operator: 'crosses_above',
  value: 195,
  name: 'AAPL-price-195-above',
  channel: 'telegram',
  status: 'active',
  created_at: '2026-05-20T10:00:00Z',
  triggered_at: null,
}

// ── GET tests ─────────────────────────────────────────────────────────────────

describe('GET /api/price-alerts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ user: fakeUser, supabase: mockSupabase })
    mockIsAuthFailure.mockReturnValue(false)
  })

  it('returns 401 when not authenticated', async () => {
    mockRequireUser.mockResolvedValue({ error: new Response(null, { status: 401 }) })
    mockIsAuthFailure.mockReturnValue(true)

    const { GET } = await import('../route')
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(401)
  })

  it('returns 200 with empty array when user has no alerts', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    })

    const { GET } = await import('../route')
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.alerts).toEqual([])
  })

  it('returns 200 with alerts array when user has alerts', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [fakeAlert], error: null }),
    })

    const { GET } = await import('../route')
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.alerts).toHaveLength(1)
    expect(body.alerts[0].id).toBe('alert-1')
    expect(body.alerts[0].ticker).toBe('AAPL')
  })

  it('returns 500 when Supabase returns an error', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
    })

    const { GET } = await import('../route')
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(500)
  })
})

// ── POST tests ────────────────────────────────────────────────────────────────

describe('POST /api/price-alerts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ user: fakeUser, supabase: mockSupabase })
    mockIsAuthFailure.mockReturnValue(false)
  })

  it('returns 401 when not authenticated', async () => {
    mockRequireUser.mockResolvedValue({ error: new Response(null, { status: 401 }) })
    mockIsAuthFailure.mockReturnValue(true)

    const { POST } = await import('../route')
    const res = await POST(makePostRequest({ ticker: 'AAPL', type: 'price', operator: 'crosses_above', value: 195, name: 'AAPL-price-195-above' }))
    expect(res.status).toBe(401)
  })

  it('returns 201 with created alert when all fields are valid', async () => {
    mockFrom.mockReturnValue({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: fakeAlert, error: null }),
    })

    const { POST } = await import('../route')
    const res = await POST(makePostRequest({
      ticker: 'AAPL',
      type: 'price',
      operator: 'crosses_above',
      value: 195,
      name: 'AAPL-price-195-above',
    }))

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.alert.id).toBe('alert-1')
    expect(body.alert.ticker).toBe('AAPL')
  })

  it('returns 400 when ticker is missing', async () => {
    const { POST } = await import('../route')
    const res = await POST(makePostRequest({
      type: 'price',
      operator: 'crosses_above',
      value: 195,
      name: 'AAPL-price-195-above',
    }))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it('returns 400 when type is missing', async () => {
    const { POST } = await import('../route')
    const res = await POST(makePostRequest({
      ticker: 'AAPL',
      operator: 'crosses_above',
      value: 195,
      name: 'AAPL-price-195-above',
    }))

    expect(res.status).toBe(400)
  })

  it('returns 400 when operator is missing', async () => {
    const { POST } = await import('../route')
    const res = await POST(makePostRequest({
      ticker: 'AAPL',
      type: 'price',
      value: 195,
      name: 'AAPL-price-195-above',
    }))

    expect(res.status).toBe(400)
  })

  it('returns 400 when value is missing', async () => {
    const { POST } = await import('../route')
    const res = await POST(makePostRequest({
      ticker: 'AAPL',
      type: 'price',
      operator: 'crosses_above',
      name: 'AAPL-price-195-above',
    }))

    expect(res.status).toBe(400)
  })

  it('returns 400 when name is missing', async () => {
    const { POST } = await import('../route')
    const res = await POST(makePostRequest({
      ticker: 'AAPL',
      type: 'price',
      operator: 'crosses_above',
      value: 195,
    }))

    expect(res.status).toBe(400)
  })

  it('returns 400 when body is empty object', async () => {
    const { POST } = await import('../route')
    const res = await POST(makePostRequest({}))
    expect(res.status).toBe(400)
  })

  it('returns 400 when body is invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/price-alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })

    const { POST } = await import('../route')
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 500 when Supabase returns an error on insert', async () => {
    mockFrom.mockReturnValue({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
    })

    const { POST } = await import('../route')
    const res = await POST(makePostRequest({
      ticker: 'AAPL',
      type: 'price',
      operator: 'crosses_above',
      value: 195,
      name: 'AAPL-price-195-above',
    }))

    expect(res.status).toBe(500)
  })
})
