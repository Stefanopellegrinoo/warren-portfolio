import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mockGetFxRate = vi.fn()
vi.mock('@/lib/fx-rates', () => ({ getFxRate: (...a: unknown[]) => mockGetFxRate(...a) }))
const service = { __client: 'service' }
vi.mock('@/lib/supabase-server', () => ({ createServiceClient: () => service }))
const mockRequireUser = vi.fn()
vi.mock('@/lib/api-auth', () => ({
  requireUser: () => mockRequireUser(),
  isAuthFailure: (r: object) => 'error' in r,
}))

const get = (q: string) => new NextRequest(`http://localhost/api/fx${q}`)
const supabase = { __client: 'user' }

beforeEach(() => {
  mockGetFxRate.mockReset()
  mockRequireUser.mockResolvedValue({ user: { id: 'u' }, supabase })
})

describe('GET /api/fx', () => {
  it('returns the MEP and CCL of the date, with the date each one used', async () => {
    mockGetFxRate.mockImplementation(async (_s: unknown, _d: string, kind: string) =>
      kind === 'mep' ? { rate: 1550.8, date: '2026-10-17' } : { rate: 1636.55, date: '2026-10-17' })
    const { GET } = await import('./route')
    const res = await GET(get('?date=2026-10-19'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ mep: { rate: 1550.8, date: '2026-10-17' }, ccl: { rate: 1636.55, date: '2026-10-17' } })
    // fx_rates is readable only by the service role (S12), never with the user's client.
    expect(mockGetFxRate).toHaveBeenCalledWith(service, '2026-10-19', 'mep')
    expect(mockGetFxRate).toHaveBeenCalledWith(service, '2026-10-19', 'ccl')
    expect(mockGetFxRate).not.toHaveBeenCalledWith(supabase, expect.anything(), expect.anything())
  })

  it('returns 400 on a bad date', async () => {
    const { GET } = await import('./route')
    for (const q of ['', '?date=2026-13-01', '?date=hoy']) expect((await GET(get(q))).status).toBe(400)
    expect(mockGetFxRate).not.toHaveBeenCalled()
  })

  it('returns 404 when there is no rate for the date', async () => {
    mockGetFxRate.mockResolvedValue(null)
    const { GET } = await import('./route')
    expect((await GET(get('?date=2010-01-04'))).status).toBe(404)
  })

  it('returns only the rate that exists (CCL history starts before MEP)', async () => {
    mockGetFxRate.mockImplementation(async (_s: unknown, _d: string, kind: string) => (kind === 'ccl' ? { rate: 15, date: '2015-03-02' } : null))
    const { GET } = await import('./route')
    const res = await GET(get('?date=2015-03-02'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ mep: null, ccl: { rate: 15, date: '2015-03-02' } })
  })

  it('requires a signed-in user', async () => {
    mockRequireUser.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) })
    const { GET } = await import('./route')
    expect((await GET(get('?date=2026-10-19'))).status).toBe(401)
  })
})
