// T5 (S5) + T13 (S13, odd/tasks/security-hardening.md): the catalog needs a session,
// is limited per user, and reads the table with the service role.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const mockOrder = vi.fn()
const mockSelect = vi.fn(() => ({ order: mockOrder }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))
vi.mock('@/lib/supabase-server', () => ({ createServiceClient: () => ({ from: mockFrom }) }))

const mockRequireUser = vi.fn()
vi.mock('@/lib/api-auth', () => ({
  requireUser: () => mockRequireUser(),
  isAuthFailure: (r: object) => 'error' in r,
}))

const mockRateLimit = vi.fn()
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  rateLimit: (...a: unknown[]) => mockRateLimit(...a),
}))

const { GET } = await import('./route')

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireUser.mockResolvedValue({ supabase: {}, user: { id: 'user-1' } })
  mockRateLimit.mockResolvedValue(true)
  mockOrder.mockResolvedValue({ data: [{ ticker: 'AAPL', ratio: 20, activos: { nombre: 'Apple' } }], error: null })
})

describe('GET /api/cedears', () => {
  it('returns the catalog with the name from activos, read with the service role', async () => {
    const res = await GET()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ ticker: 'AAPL', ratio: 20, nombre: 'Apple' }])
    expect(mockFrom).toHaveBeenCalledWith('cedears')
    expect(mockSelect).toHaveBeenCalledWith('ticker, ratio, activos!inner(nombre)')
  })

  it('returns 401 without a session and reads nothing', async () => {
    mockRequireUser.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) })

    const res = await GET()

    expect(res.status).toBe(401)
    expect(mockRateLimit).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('returns 429 once the user is over 60 requests per 60 s', async () => {
    mockRateLimit.mockResolvedValue(false)

    const res = await GET()

    expect(mockRateLimit).toHaveBeenCalledWith('rl:cedears:user-1', 60, 60)
    expect(res.status).toBe(429)
    expect(mockFrom).not.toHaveBeenCalled()
  })
})
