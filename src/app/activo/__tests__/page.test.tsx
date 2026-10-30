import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { forgetCached } from '@/lib/client-cache'

const identity = vi.fn(async (_t: string): Promise<{ found: boolean }> => ({ found: true }))
const loadOn = vi.fn(async () => ({
  analyses: [
    { row: { isin: 'ARXXXX000001', tickerO: 'AAAAO', tickerD: 'AAAAD' }, detail: { tickerC: 'AAAAC' } },
    { row: { isin: 'ARYYYY000002', tickerO: 'BBBBO', tickerD: null }, detail: { tickerC: null } },
  ],
}))
const redirect = vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT ${url}`) })

vi.mock('@/components/asset/numeros/NumerosTab', () => ({ NumerosTab: () => null }))
vi.mock('@/lib/ticker-identity', () => ({ resolveTickerIdentity: (t: string) => identity(t) }))
vi.mock('@/lib/on-catalog', () => ({ loadOnAnalyses: () => loadOn() }))
vi.mock('@/lib/supabase-server', () => ({ createServiceClient: () => ({}) }))
vi.mock('next/navigation', async (importOriginal) => ({ ...(await importOriginal<object>()), redirect: (url: string) => redirect(url) }))

import AssetRoute from '../[ticker]/page'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => { identity.mockClear(); loadOn.mockClear(); redirect.mockClear() })
afterEach(() => { vi.unstubAllGlobals(); forgetCached(); document.body.innerHTML = '' })

// odd/tasks/asset-page.md S1, S9: /activo/<ticker>?vs=… asks the API for that ticker with those peers.
async function urlsFor(params: { ticker: string }, searchParams: { vs?: string | string[] }) {
  const urls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { urls.push(url); return Response.json({ error: 'x' }, { status: 404 }) }))
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  const page = await AssetRoute({ params, searchParams })
  await act(async () => { root.render(page) })
  act(() => root.unmount())
  return urls
}

describe('/activo/[ticker]', () => {
  it('forwards ?vs= to the API', async () => {
    expect(await urlsFor({ ticker: 'MELI' }, { vs: 'AMZN,SE' })).toEqual(['/api/asset/MELI?vs=AMZN%2CSE'])
    expect(await urlsFor({ ticker: 'MELI' }, {})).toEqual(['/api/asset/MELI'])
    expect(await urlsFor({ ticker: 'MELI' }, { vs: '' })).toEqual(['/api/asset/MELI?vs='])
  })

  it('reads an encoded ticker once, never encoding it twice', async () => {
    expect(await urlsFor({ ticker: 'BCBA%3AGGAL' }, {})).toEqual(['/api/asset/BCBA%3AGGAL'])
  })
})

describe('/activo/[ticker]: an ON (T10)', () => {
  it('sends an ON the catalog knows, by any of its tickers or its ISIN, to /ons/<isin>', async () => {
    identity.mockResolvedValue({ found: false })
    for (const ticker of ['aaaao', 'AAAAD', 'AAAAC', 'ARXXXX000001']) {
      await expect(AssetRoute({ params: { ticker }, searchParams: {} })).rejects.toThrow('NEXT_REDIRECT /ons/ARXXXX000001')
    }
    await expect(AssetRoute({ params: { ticker: 'BBBBO' }, searchParams: {} })).rejects.toThrow('NEXT_REDIRECT /ons/ARYYYY000002')
  })

  it("never reads the catalog for an asset Yahoo knows; an unknown ticker keeps the page and its 404", async () => {
    identity.mockResolvedValue({ found: true })
    expect(await urlsFor({ ticker: 'MELI' }, {})).toEqual(['/api/asset/MELI'])
    expect(loadOn).not.toHaveBeenCalled()

    identity.mockResolvedValue({ found: false })
    expect(await urlsFor({ ticker: 'ZZZZQ' }, {})).toEqual(['/api/asset/ZZZZQ'])
    expect(loadOn).toHaveBeenCalledTimes(1)
    expect(redirect).not.toHaveBeenCalled()
  })

  it('keeps the page when the identity or the catalog fails, and asks nothing for an invalid ticker', async () => {
    identity.mockRejectedValueOnce(new Error('HTTP 503'))
    expect(await urlsFor({ ticker: 'AAAAO' }, {})).toEqual(['/api/asset/AAAAO'])
    identity.mockResolvedValue({ found: false })
    loadOn.mockRejectedValueOnce(new Error('supabase down'))
    expect(await urlsFor({ ticker: 'AAAAO' }, {})).toEqual(['/api/asset/AAAAO'])
    identity.mockClear()
    await urlsFor({ ticker: 'b@d' }, {})
    expect(identity).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })
})
