import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import MovementsList from '../MovementsList'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const movements = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `m${i + 1}`, user_id: 'u', type: 'DEPOSITO', amount: 100 + i, date: '2026-10-01', description: `Movimiento ${i + 1}`, transaction_id: null,
}))

let root: Root | null = null
afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

/** Serves `all` the way the API does: one page per limit/offset, with the total. */
function serve(all: ReturnType<typeof movements>) {
  const urls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url)
    const q = new URL(url, 'http://x').searchParams
    const limit = Number(q.get('limit') ?? 100), offset = Number(q.get('offset') ?? 0)
    return { ok: true, json: async () => ({ data: all.slice(offset, offset + limit), pagination: { total: all.length } }) }
  }))
  return urls
}

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

async function mount(refreshKey = 0) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  act(() => root!.render(<MovementsList refreshKey={refreshKey} onChanged={() => {}} />))
  await flush()
  return {
    el,
    rows: () => [...el.querySelectorAll('#movements-list li')].map(li => li.textContent ?? ''),
    status: () => el.querySelector('[data-testid="movements-range"]')?.textContent ?? null,
    prev: () => el.querySelector<HTMLButtonElement>('button[aria-label="Movimientos más recientes"]'),
    next: () => el.querySelector<HTMLButtonElement>('button[aria-label="Movimientos anteriores"]'),
    rerender: async (key: number) => { act(() => root!.render(<MovementsList refreshKey={key} onChanged={() => {}} />)); await flush() },
  }
}

describe('MovementsList pagination', () => {
  it('asks the API for one page of five, never the whole history', async () => {
    const urls = serve(movements(12))
    const m = await mount()
    expect(urls[0]).toBe('/api/cash/movements?limit=5&offset=0')
    expect(m.rows()).toHaveLength(5)
    expect(m.rows()[0]).toContain('Movimiento 1')
  })

  it('moves page by page with the arrows and shows where you are', async () => {
    const urls = serve(movements(12))
    const m = await mount()
    expect(m.status()).toBe('1–5 de 12')
    expect(m.prev()!.disabled).toBe(true)
    expect(m.next()!.disabled).toBe(false)

    act(() => m.next()!.click())
    await flush()
    expect(urls.at(-1)).toBe('/api/cash/movements?limit=5&offset=5')
    expect(m.status()).toBe('6–10 de 12')
    expect(m.rows()[0]).toContain('Movimiento 6')

    act(() => m.next()!.click())
    await flush()
    expect(m.status()).toBe('11–12 de 12')
    expect(m.rows()).toHaveLength(2)
    expect(m.next()!.disabled).toBe(true)

    act(() => m.prev()!.click())
    await flush()
    expect(m.status()).toBe('6–10 de 12')
  })

  it('shows no pager when everything fits in one page', async () => {
    serve(movements(4))
    const m = await mount()
    expect(m.rows()).toHaveLength(4)
    expect(m.status()).toBeNull()
    expect(m.next()).toBeNull()
  })

  it('goes back to the newest page when the portfolio changes', async () => {
    const urls = serve(movements(12))
    const m = await mount()
    act(() => m.next()!.click())
    await flush()
    await m.rerender(1)
    expect(urls.at(-1)).toBe('/api/cash/movements?limit=5&offset=0')
    expect(m.status()).toBe('1–5 de 12')
  })

  it('steps back a page when a delete empties the last one', async () => {
    const all = movements(6)
    const urls = serve(all)
    vi.stubGlobal('confirm', () => true)
    const m = await mount()
    act(() => m.next()!.click())
    await flush()
    expect(m.rows()).toHaveLength(1)

    const fetchMock = vi.mocked(fetch)
    const serveList = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url, init) => {
      if (init?.method === 'DELETE') { all.pop(); return { ok: true, json: async () => ({}) } as Response }
      return serveList(url, init)
    })
    await act(async () => { m.el.querySelector<HTMLButtonElement>('button[aria-label^="Borrar"]')!.click() })
    await flush()
    await flush()
    expect(urls.at(-1)).toBe('/api/cash/movements?limit=5&offset=0')
    expect(m.rows()).toHaveLength(5)
    expect(m.status()).toBeNull()
  })

  it('says so when there are no movements', async () => {
    serve([])
    const m = await mount()
    expect(m.el.textContent).toContain('Todavía no hay movimientos de caja.')
    expect(m.status()).toBeNull()
  })
})
