// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

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

// The real loader, watched: a bad ticker must be refused before it reaches any source.
const mockGetAssetStatements = vi.fn()
vi.mock('@/lib/fundamentals/service', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/fundamentals/service')>()
  return { ...real, getAssetStatements: (...a: Parameters<typeof real.getAssetStatements>) => mockGetAssetStatements(...a) }
})

import { GET } from '../route'
import { AssetError } from '@/lib/fundamentals/service'

/** `param` is the path segment as Next hands it over, possibly still percent-encoded. */
const call = (param: string) =>
  GET(new NextRequest(`http://localhost/api/asset/${param}/statements`), { params: { ticker: param } })

describe('GET /api/asset/[ticker]/statements', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ user: { id: 'user-1' }, supabase: {} })
    mockRateLimit.mockResolvedValue(true)
    const real = await vi.importActual<typeof import('@/lib/fundamentals/service')>('@/lib/fundamentals/service')
    // Any source call would hit the network: these tests stop before one.
    mockGetAssetStatements.mockImplementation((t) => real.getAssetStatements(t, { resolveIdentity: vi.fn(async () => { throw new Error('no network in tests') }) }))
  })

  it('answers 401 without a session and touches nothing else', async () => {
    mockRequireUser.mockResolvedValue({ error: NextResponse.json({ error: 'x' }, { status: 401 }) })
    const res = await call('MELI')
    expect(res.status).toBe(401)
    expect(mockRateLimit).not.toHaveBeenCalled()
    expect(mockGetAssetStatements).not.toHaveBeenCalled()
  })

  it("answers 429 over the asset route's 60 requests per user per minute", async () => {
    mockRateLimit.mockResolvedValue(false)
    const res = await call('MELI')
    expect(mockRateLimit).toHaveBeenCalledWith('rl:asset-statements:user-1', 60, 60)
    expect(res.status).toBe(429)
    expect(mockGetAssetStatements).not.toHaveBeenCalled()
  })

  it('answers 400 for a bad ticker, before any source call', async () => {
    for (const param of ['MELI%3B%20DROP', '%E0%A4%A']) {
      const res = await call(param)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Ese ticker no es válido. Revisá cómo está escrito.' })
    }
  })

  it('answers 404 when the ticker does not exist', async () => {
    mockGetAssetStatements.mockRejectedValue(new AssetError('not_found'))
    const res = await call('ZZZZQ')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'No encontramos datos de ese ticker. Revisá cómo está escrito.' })
  })

  it('passes the decoded ticker to the loader and returns its statements', async () => {
    const statements = { yahoo: null, tradingview: null, sources: { yahoo: 'error' } }
    mockGetAssetStatements.mockResolvedValue(statements)

    const res = await call('BCBA%3AGGAL')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(statements)
    expect(mockGetAssetStatements).toHaveBeenCalledWith('BCBA:GGAL')
  })

  it('a loader failure is a 500 with no detail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetAssetStatements.mockRejectedValue(new Error('redis down at 10.0.0.3'))
    const res = await call('MELI')
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('10.0.0.3')
  })
})
