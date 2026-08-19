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

function setupAuth() {
  mockRequireUser.mockResolvedValue({ user: fakeUser, supabase: mockSupabase })
  mockIsAuthFailure.mockReturnValue(false)
}

function makePostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/drawings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeDeleteRequest(ticker?: string) {
  const url = ticker
    ? `http://localhost/api/drawings?ticker=${encodeURIComponent(ticker)}`
    : 'http://localhost/api/drawings'
  return new NextRequest(url, { method: 'DELETE' })
}

const fakeRow = {
  id: 'draw-1',
  user_id: 'user-1',
  ticker: 'AAPL',
  type: 'hline',
  points: [{ time: 1700000000, price: 150 }],
  style: {},
  label: null,
  created_at: '2026-05-20T10:00:00Z',
  updated_at: '2026-05-20T10:00:00Z',
}

// ── POST — Zod validation ─────────────────────────────────────────────────────

describe('POST /api/drawings — Zod validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupAuth()
    vi.resetModules()
  })

  it('accepts single-point hline (min(1))', async () => {
    mockFrom.mockReturnValue({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: fakeRow, error: null }),
    })

    const { POST } = await import('../route')
    const res = await POST(
      makePostRequest({ ticker: 'AAPL', type: 'hline', points: [{ time: 1700000000, price: 150 }] })
    )
    expect(res.status).toBe(201)
  })

  it('accepts two-point trendline', async () => {
    const twoPointRow = { ...fakeRow, type: 'trendline', points: [{ time: 1700000000, price: 100 }, { time: 1700086400, price: 110 }] }
    mockFrom.mockReturnValue({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: twoPointRow, error: null }),
    })

    const { POST } = await import('../route')
    const res = await POST(
      makePostRequest({
        ticker: 'AAPL',
        type: 'trendline',
        points: [{ time: 1700000000, price: 100 }, { time: 1700086400, price: 110 }],
      })
    )
    expect(res.status).toBe(201)
  })

  it('accepts three-point channel (max(3))', async () => {
    const threePointRow = {
      ...fakeRow,
      type: 'channel',
      points: [
        { time: 1700000000, price: 100 },
        { time: 1700086400, price: 110 },
        { time: 1700172800, price: 105 },
      ],
    }
    mockFrom.mockReturnValue({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: threePointRow, error: null }),
    })

    const { POST } = await import('../route')
    const res = await POST(
      makePostRequest({
        ticker: 'AAPL',
        type: 'channel',
        points: [
          { time: 1700000000, price: 100 },
          { time: 1700086400, price: 110 },
          { time: 1700172800, price: 105 },
        ],
      })
    )
    expect(res.status).toBe(201)
  })

  it('rejects zero points', async () => {
    const { POST } = await import('../route')
    const res = await POST(
      makePostRequest({ ticker: 'AAPL', type: 'hline', points: [] })
    )
    expect(res.status).toBe(400)
  })

  it('rejects four or more points', async () => {
    const { POST } = await import('../route')
    const res = await POST(
      makePostRequest({
        ticker: 'AAPL',
        type: 'channel',
        points: Array(4).fill({ time: 1700000000, price: 100 }),
      })
    )
    expect(res.status).toBe(400)
  })

  it('rejects unknown drawing type', async () => {
    const { POST } = await import('../route')
    const res = await POST(
      makePostRequest({
        ticker: 'AAPL',
        type: 'rectangle',
        points: [{ time: 1700000000, price: 100 }, { time: 1700086400, price: 110 }],
      })
    )
    expect(res.status).toBe(400)
  })

  it('accepts all eight valid drawing types', async () => {
    // Per-type strict point counts (discriminated union)
    const p1 = { time: 1700000000, price: 100 }
    const p2 = { time: 1700086400, price: 110 }
    const p3 = { time: 1700172800, price: 105 }
    const cases: Array<{ type: 'trendline' | 'fibonacci' | 'hline' | 'horizontal_ray' | 'ray' | 'channel' | 'price_range' | 'arrow'; points: typeof p1[] }> = [
      { type: 'hline',          points: [p1] },
      { type: 'horizontal_ray', points: [p1] },
      { type: 'trendline',      points: [p1, p2] },
      { type: 'fibonacci',      points: [p1, p2] },
      { type: 'ray',            points: [p1, p2] },
      { type: 'price_range',    points: [p1, p2] },
      { type: 'arrow',          points: [p1, p2] },
      { type: 'channel',        points: [p1, p2, p3] },
    ]
    for (const { type, points } of cases) {
      vi.clearAllMocks()
      setupAuth()
      vi.resetModules()

      const row = { ...fakeRow, type, points }
      mockFrom.mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: row, error: null }),
      })

      const { POST } = await import('../route')
      const res = await POST(
        makePostRequest({
          ticker: 'AAPL',
          type,
          points,
        })
      )
      expect(res.status, `type=${type} should return 201`).toBe(201)
    }
  })

  it('rejects mismatched point counts per type (discriminated union)', async () => {
    setupAuth()
    vi.resetModules()
    const { POST } = await import('../route')

    // hline must have exactly 1 point
    const r1 = await POST(makePostRequest({
      ticker: 'AAPL',
      type: 'hline',
      points: [{ time: 1, price: 100 }, { time: 2, price: 101 }],
    }))
    expect(r1.status, 'hline with 2 points must be 400').toBe(400)

    // channel must have exactly 3 points
    const r2 = await POST(makePostRequest({
      ticker: 'AAPL',
      type: 'channel',
      points: [{ time: 1, price: 100 }, { time: 2, price: 101 }],
    }))
    expect(r2.status, 'channel with 2 points must be 400').toBe(400)

    // trendline must have exactly 2 points
    const r3 = await POST(makePostRequest({
      ticker: 'AAPL',
      type: 'trendline',
      points: [{ time: 1, price: 100 }],
    }))
    expect(r3.status, 'trendline with 1 point must be 400').toBe(400)
  })
})

// ── DELETE ?ticker=X ──────────────────────────────────────────────────────────

describe('DELETE /api/drawings?ticker=X', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupAuth()
    vi.resetModules()
  })

  it('returns 400 when ticker param is missing', async () => {
    const { DELETE } = await import('../route')
    const res = await DELETE(makeDeleteRequest())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/ticker/i)
  })

  it('deletes all drawings for the given ticker and returns 204', async () => {
    const mockDelete = vi.fn().mockReturnThis()
    const mockEq = vi.fn().mockReturnThis()
    const mockEq2 = vi.fn().mockResolvedValue({ error: null })
    mockFrom.mockReturnValue({
      delete: mockDelete,
      eq: mockEq,
    })
    // Chain: .from().delete().eq(user_id).eq(ticker)
    mockEq
      .mockReturnValueOnce({ eq: mockEq2 })

    const { DELETE } = await import('../route')
    const res = await DELETE(makeDeleteRequest('AAPL'))
    expect(res.status).toBe(204)
  })

  it('uppercases the ticker before querying', async () => {
    const capturedArgs: Array<[string, string]> = []
    // Each call to .eq() returns an object with another .eq() so we can chain
    // .from().delete().eq(user_id, ...).eq(ticker, ...)
    const mockEqInner = vi.fn().mockImplementation((col: string, val: string) => {
      capturedArgs.push([col, val])
      return Promise.resolve({ error: null })
    })
    const mockEqOuter = vi.fn().mockImplementation((col: string, val: string) => {
      capturedArgs.push([col, val])
      return { eq: mockEqInner }
    })
    mockFrom.mockReturnValue({
      delete: vi.fn().mockReturnValue({ eq: mockEqOuter }),
    })

    const { DELETE } = await import('../route')
    await DELETE(makeDeleteRequest('aapl'))
    // The ticker should be uppercased — it's the second eq call
    const tickerArg = capturedArgs.find(([col]) => col === 'ticker')
    expect(tickerArg?.[1]).toBe('AAPL')
  })

  it('returns 500 when Supabase delete fails', async () => {
    mockFrom.mockReturnValue({
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    })
    // Simulate error on final eq
    const mockEqFinal = vi.fn().mockResolvedValue({ error: { message: 'db error' } })
    mockFrom.mockReturnValue({
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnValueOnce({ eq: mockEqFinal }),
    })

    const { DELETE } = await import('../route')
    const res = await DELETE(makeDeleteRequest('AAPL'))
    expect(res.status).toBe(500)
  })
})

// ── TARGET_CLICKS map ─────────────────────────────────────────────────────────

describe('TARGET_CLICKS map', () => {
  it('hline requires 1 click', async () => {
    const { TARGET_CLICKS } = await import('@/lib/types/drawings')
    expect(TARGET_CLICKS.hline).toBe(1)
  })

  it('trendline requires 2 clicks', async () => {
    const { TARGET_CLICKS } = await import('@/lib/types/drawings')
    expect(TARGET_CLICKS.trendline).toBe(2)
  })

  it('fibonacci requires 2 clicks', async () => {
    const { TARGET_CLICKS } = await import('@/lib/types/drawings')
    expect(TARGET_CLICKS.fibonacci).toBe(2)
  })

  it('ray requires 2 clicks', async () => {
    const { TARGET_CLICKS } = await import('@/lib/types/drawings')
    expect(TARGET_CLICKS.ray).toBe(2)
  })

  it('price_range requires 2 clicks', async () => {
    const { TARGET_CLICKS } = await import('@/lib/types/drawings')
    expect(TARGET_CLICKS.price_range).toBe(2)
  })

  it('channel requires 3 clicks', async () => {
    const { TARGET_CLICKS } = await import('@/lib/types/drawings')
    expect(TARGET_CLICKS.channel).toBe(3)
  })

  it('covers all 8 DrawingType values', async () => {
    const { TARGET_CLICKS } = await import('@/lib/types/drawings')
    const keys = Object.keys(TARGET_CLICKS)
    expect(keys).toHaveLength(8)
    expect(keys).toContain('trendline')
    expect(keys).toContain('fibonacci')
    expect(keys).toContain('hline')
    expect(keys).toContain('horizontal_ray')
    expect(keys).toContain('ray')
    expect(keys).toContain('channel')
    expect(keys).toContain('price_range')
    expect(keys).toContain('arrow')
  })
})
