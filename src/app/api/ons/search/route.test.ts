// T5 (odd/tasks/security-hardening.md S5): the public ON search is limited per IP,
// clamps `limit`, and never returns internal error text.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockLimit = vi.fn()
const mockFrom = vi.fn(() => ({ select: () => ({ ilike: () => ({ limit: mockLimit }) }) }))
vi.mock('@/lib/supabase-server', () => ({ createServerClientInstance: () => ({ from: mockFrom }) }))

const mockBonds = vi.fn()
vi.mock('@/lib/data912-client', () => ({ getAvailableCorporateBonds: () => mockBonds() }))

const mockRateLimit = vi.fn()
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  rateLimit: (...a: unknown[]) => mockRateLimit(...a),
}))

const { GET } = await import('./route')
const search = (params: string) =>
  GET(new NextRequest(`http://localhost/api/ons/search?${params}`, { headers: { 'x-forwarded-for': '5.6.7.8, 10.0.0.1' } }))

beforeEach(() => {
  vi.clearAllMocks()
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

  it('returns 429 once the IP is over 60 searches per 60 s', async () => {
    mockRateLimit.mockResolvedValue(false)

    const res = await search('q=aer')

    expect(mockRateLimit).toHaveBeenCalledWith('rl:ons-search:5.6.7.8', 60, 60)
    expect(res.status).toBe(429)
    expect(mockFrom).not.toHaveBeenCalled()
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
    expect(await res.json()).toEqual({ error: 'Failed to search bonds' })
  })
})
