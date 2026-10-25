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

  it('a ticker never saved comes with its legacy rows in the same response: one round trip', async () => {
    const sets = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }
    const row = { id: 'r1', type: 'trendline', points: [{ time: 1, price: 2 }, { time: 3, price: 4 }], style: null, label: null }
    const legacy = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue({ data: [row], error: null }) }
    mockFrom.mockImplementation((table: string) => (table === 'chart_drawing_sets' ? sets : legacy))
    const { GET } = await import('../route')

    const res = await GET(new NextRequest(url('aapl')))

    expect(await res.json()).toEqual({
      drawings: null,
      legacy: [{ id: 'r1', type: 'trendline', points: [{ time: 1, price: 2 }, { time: 3, price: 4 }], style: {} }],
    })
    expect(mockFrom).toHaveBeenCalledWith('chart_drawings')
    expect(legacy.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(legacy.eq).toHaveBeenCalledWith('ticker', 'AAPL')
    expect(legacy.order).toHaveBeenCalledWith('created_at', { ascending: true })
  })

  it('reads the legacy table as production has it: no label column', async () => {
    // PostgREST answers 400 when the select names a column the table lacks.
    const PROD_COLUMNS = ['id', 'user_id', 'ticker', 'type', 'points', 'style', 'created_at', 'updated_at']
    const sets = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }
    const row = { id: 'r1', user_id: 'user-1', ticker: 'FXI', type: 'trendline', points: [{ time: 1, price: 2 }, { time: 3, price: 4 }], style: {} }
    let columns = '*'
    const legacy = {
      select: vi.fn((c: string) => ((columns = c), legacy)),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn(async () =>
        columns === '*' || columns.split(',').every((c) => PROD_COLUMNS.includes(c.trim()))
          ? { data: [row], error: null }
          : { data: null, error: { message: 'column chart_drawings.label does not exist' } }
      ),
    }
    mockFrom.mockImplementation((table: string) => (table === 'chart_drawing_sets' ? sets : legacy))
    const { GET } = await import('../route')

    const res = await GET(new NextRequest(url('fxi')))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      drawings: null,
      legacy: [{ id: 'r1', type: 'trendline', points: [{ time: 1, price: 2 }, { time: 3, price: 4 }], style: {} }],
    })
  })

  it('a saved ticker never reads the legacy table', async () => {
    selectChain({ data: { drawings: [trendLine] }, error: null })
    const { GET } = await import('../route')

    await GET(new NextRequest(url('AAPL')))

    expect(mockFrom).toHaveBeenCalledTimes(1)
  })

  it('a legacy read error is a generic 500', async () => {
    const sets = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }
    const legacy = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }) }
    mockFrom.mockImplementation((table: string) => (table === 'chart_drawing_sets' ? sets : legacy))
    const { GET } = await import('../route')

    const res = await GET(new NextRequest(url('AAPL')))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: GENERIC_ERROR })
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
