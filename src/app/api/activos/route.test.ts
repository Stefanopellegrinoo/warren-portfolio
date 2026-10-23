// T5 (odd/tasks/security-hardening.md S5): the public catalog is limited per IP.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockOrder = vi.fn()
const mockFrom = vi.fn(() => ({ select: () => ({ order: mockOrder }) }))
vi.mock('@/lib/supabase-server', () => ({ createServerClientInstance: () => ({ from: mockFrom }) }))

const mockRateLimit = vi.fn()
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  rateLimit: (...a: unknown[]) => mockRateLimit(...a),
}))

const { GET } = await import('./route')
const request = () => new NextRequest('http://localhost/api/activos', { headers: { 'cf-connecting-ip': '1.2.3.4' } })

beforeEach(() => {
  vi.clearAllMocks()
  mockRateLimit.mockResolvedValue(true)
  mockOrder.mockResolvedValue({ data: [{ ticker: 'AAPL', nombre: 'Apple' }], error: null })
})

describe('GET /api/activos', () => {
  it('returns the catalog', async () => {
    const res = await GET(request())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ ticker: 'AAPL', nombre: 'Apple' }])
  })

  it('returns 429 once the IP is over 60 requests per 60 s', async () => {
    mockRateLimit.mockResolvedValue(false)

    const res = await GET(request())

    expect(mockRateLimit).toHaveBeenCalledWith('rl:activos:1.2.3.4', 60, 60)
    expect(res.status).toBe(429)
    expect(mockFrom).not.toHaveBeenCalled()
  })
})
