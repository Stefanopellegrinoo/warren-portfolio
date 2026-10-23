import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GENERIC_ERROR } from '@/lib/api/errors'

const mockRequireUser = vi.fn()
const mockIsAuthFailure = vi.fn()
vi.mock('@/lib/api-auth', () => ({
  requireUser: mockRequireUser,
  isAuthFailure: mockIsAuthFailure,
}))

const mockFrom = vi.fn()
const mockSupabase = { from: mockFrom }

function setupAuth() {
  mockRequireUser.mockResolvedValue({ user: { id: 'user-1' }, supabase: mockSupabase })
  mockIsAuthFailure.mockReturnValue(false)
}

const url = (ticker?: string) =>
  `http://localhost/api/chart-drawings${ticker ? `?ticker=${encodeURIComponent(ticker)}` : ''}`

function selectChain(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
  mockFrom.mockReturnValue(chain)
  return chain
}

function upsertChain(result: { error: unknown }) {
  const chain = { upsert: vi.fn().mockResolvedValue(result) }
  mockFrom.mockReturnValue(chain)
  return chain
}

const trendLine = {
  id: 'd1',
  kind: 'trend-line',
  points: [{ time: 1743379200, price: 546.87 }, { time: 1775174400, price: 735.09 }],
  style: {},
}

describe('GET /api/chart-drawings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    setupAuth()
  })

  it('returns the saved drawings of the user for the upper-cased ticker', async () => {
    const chain = selectChain({ data: { drawings: [trendLine] }, error: null })
    const { GET } = await import('../route')

    const res = await GET(new NextRequest(url('aapl')))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ drawings: [trendLine] })
    expect(mockFrom).toHaveBeenCalledWith('chart_drawing_sets')
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(chain.eq).toHaveBeenCalledWith('ticker', 'AAPL')
  })

  it('returns drawings: null when the ticker was never saved, so the client can bring the legacy rows over', async () => {
    selectChain({ data: null, error: null })
    const { GET } = await import('../route')

    const res = await GET(new NextRequest(url('AAPL')))

    expect(await res.json()).toEqual({ drawings: null })
  })

  it('rejects a missing ticker with 400', async () => {
    const { GET } = await import('../route')

    const res = await GET(new NextRequest(url()))

    expect(res.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('answers a database error with a generic 500, never its text', async () => {
    selectChain({ data: null, error: { message: 'boom' } })
    const { GET } = await import('../route')

    const res = await GET(new NextRequest(url('AAPL')))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: GENERIC_ERROR })
  })
})

describe('PUT /api/chart-drawings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    setupAuth()
  })

  const put = (body: unknown) =>
    new NextRequest(url(), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  it('upserts the whole drawing list for user and ticker', async () => {
    const chain = upsertChain({ error: null })
    const { PUT } = await import('../route')

    const res = await PUT(put({ ticker: 'aapl', drawings: [trendLine] }))

    expect(res.status).toBe(204)
    expect(chain.upsert).toHaveBeenCalledWith(
      { user_id: 'user-1', ticker: 'AAPL', drawings: [trendLine] },
      { onConflict: 'user_id,ticker' }
    )
  })

  it('accepts an empty list (every drawing removed)', async () => {
    const chain = upsertChain({ error: null })
    const { PUT } = await import('../route')

    const res = await PUT(put({ ticker: 'AAPL', drawings: [] }))

    expect(res.status).toBe(204)
    expect(chain.upsert.mock.calls[0][0].drawings).toEqual([])
  })

  it('rejects a drawing without id, kind or points with 400 and writes nothing', async () => {
    const chain = upsertChain({ error: null })
    const { PUT } = await import('../route')

    const res = await PUT(put({ ticker: 'AAPL', drawings: [{ kind: 'trend-line' }] }))

    expect(res.status).toBe(400)
    expect(chain.upsert).not.toHaveBeenCalled()
  })

  it('rejects more than 500 drawings', async () => {
    upsertChain({ error: null })
    const { PUT } = await import('../route')

    const res = await PUT(put({ ticker: 'AAPL', drawings: Array.from({ length: 501 }, (_, i) => ({ ...trendLine, id: `d${i}` })) }))

    expect(res.status).toBe(400)
  })

  it('answers a database error with a generic 500, never its text', async () => {
    upsertChain({ error: { message: 'denied' } })
    const { PUT } = await import('../route')

    const res = await PUT(put({ ticker: 'AAPL', drawings: [] }))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: GENERIC_ERROR })
  })
})
