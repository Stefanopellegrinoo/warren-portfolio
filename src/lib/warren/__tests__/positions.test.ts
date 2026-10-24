import { describe, it, expect, vi, afterEach } from 'vitest'
import { forgetCached } from '@/lib/client-cache'
import { getCedearRatios, getPortfolio } from '../positions'

afterEach(() => { vi.unstubAllGlobals(); forgetCached() })

const answer = (body: unknown) => vi.fn(async () => Response.json(body))

describe('the portfolio and the CEDEAR ratios on the client (S5)', () => {
  it('components asking for the portfolio at the same time share one request', async () => {
    const fetchMock = answer({ positions: [{ ticker: 'AAPL' }], onPositions: [], summary: {}, lastRefresh: null })
    vi.stubGlobal('fetch', fetchMock)

    const [a, b] = await Promise.all([getPortfolio(), getPortfolio()])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(a.positions[0].ticker).toBe('AAPL')
    expect(b).toBe(a)
  })

  it('the CEDEAR ratios, a catalog, are asked once per tab', async () => {
    const fetchMock = answer([{ ticker: 'AAPL', ratio: 20, nombre: 'Apple' }])
    vi.stubGlobal('fetch', fetchMock)

    await getCedearRatios()
    const ratios = await getCedearRatios()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(ratios.get('AAPL')).toBe(20)
  })

  it('a failed portfolio request says why', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500, statusText: 'Server Error' })))

    await expect(getPortfolio()).rejects.toThrow('GET /api/positions failed: 500 Server Error')
  })
})
