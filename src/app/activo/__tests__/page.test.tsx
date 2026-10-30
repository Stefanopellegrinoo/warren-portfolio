import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { forgetCached } from '@/lib/client-cache'

vi.mock('@/components/asset/numeros/NumerosTab', () => ({ NumerosTab: () => null }))

import AssetRoute from '../[ticker]/page'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { vi.unstubAllGlobals(); forgetCached(); document.body.innerHTML = '' })

// odd/tasks/asset-page.md S1, S9: /activo/<ticker>?vs=… asks the API for that ticker with those peers.
async function urlsFor(params: { ticker: string }, searchParams: { vs?: string | string[] }) {
  const urls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { urls.push(url); return Response.json({ error: 'x' }, { status: 404 }) }))
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<AssetRoute params={params} searchParams={searchParams} />) })
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
