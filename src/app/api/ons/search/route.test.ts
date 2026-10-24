// T5 (S5) + T13 (S13, odd/tasks/security-hardening.md): the ON search needs a session,
// is limited per user, reads `ons` with the service role, clamps `limit`, and never
// returns internal error text.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mockLimit = vi.fn()
const mockFrom = vi.fn(() => ({ select: () => ({ ilike: () => ({ limit: mockLimit }) }) }))
vi.mock('@/lib/supabase-server', () => ({ createServiceClient: () => ({ from: mockFrom }) }))

const mockRequireUser = vi.fn()
vi.mock('@/lib/api-auth', () => ({
  requireUser: () => mockRequireUser(),
  isAuthFailure: (r: object) => 'error' in r,
}))

const mockBonds = vi.fn()
vi.mock('@/lib/data912-client', () => ({ getAvailableCorporateBonds: () => mockBonds() }))

const mockRateLimit = vi.fn()
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  rateLimit: (...a: unknown[]) => mockRateLimit(...a),
}))

const { GET } = await import('./route')
const search = (params: string) => GET(new NextRequest(`http://localhost/api/ons/search?${params}`))

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireUser.mockResolvedValue({ supabase: {}, user: { id: 'user-1' } })
  mockRateLimit.mockResolvedValue(true)
  mockLimit.mockResolvedValue({ data: [{ ticker: 'AERBD', name: 'Aeropuertos' }] })
  mockBonds.mockResolvedValue(['AERBD', 'AERCD', 'AERBO'])
})

describe('GET /api/ons/search', () => {
  it('returns database bonds first, then the matching data912 dollar bonds', async () => {
    const res = await search('q=aer')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      results: [
        { ticker: 'AERBD', name: 'Aeropuertos', source: 'database' },
        { ticker: 'AERCD', source: 'data912' },
      ],
      query: 'AER',
      count: 2,
    })
  })

  it('returns 401 without a session, before any database read or data912 fetch', async () => {
    mockRequireUser.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) })

    const res = await search('q=aer')

    expect(res.status).toBe(401)
    expect(mockRateLimit).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockBonds).not.toHaveBeenCalled()
  })

  it('returns 429 once the user is over 60 searches per 60 s', async () => {
    mockRateLimit.mockResolvedValue(false)

    const res = await search('q=aer')

    expect(mockRateLimit).toHaveBeenCalledWith('rl:ons-search:user-1', 60, 60)
    expect(res.status).toBe(429)
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockBonds).not.toHaveBeenCalled()
  })

  it.each([
    ['1000', 50],
    ['0', 1],
    ['abc', 10],
  ])('clamps limit=%s to %d', async (limit, expected) => {
    await search(`q=aer&limit=${limit}`)

    expect(mockLimit).toHaveBeenCalledWith(expected)
  })

  it('returns a generic 500 without the internal error message', async () => {
    mockFrom.mockImplementationOnce(() => { throw new Error('connection to db-internal:5432 refused') })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await search('q=aer')

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'No se pudo completar la operación' })
  })
})
