import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { toast } from 'sonner'
import MovementsList from '../MovementsList'
import { forgetCached } from '@/lib/client-cache'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

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
  forgetCached()
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
    act(() => m.el.querySelector<HTMLButtonElement>('button[aria-label^="Borrar"]')!.click())
    await act(async () => { button(m.el, 'Sí, borrar')!.click() })
    await flush()
    await flush()
    expect(urls.at(-1)).toBe('/api/cash/movements?limit=5&offset=0')
    expect(m.rows()).toHaveLength(5)
    expect(m.status()).toBeNull()
  })

  // odd/tasks/rendimiento.md S7: a page seen before in the tab shows its last data at once and refreshes behind.
  it('a list seen before in the tab shows at once while it asks again', async () => {
    serve(movements(3))
    await mount()
    act(() => root!.unmount())
    let release!: () => void
    const serveList = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation(async (url, init) => { await new Promise<void>(r => { release = r }); return serveList(url, init) })
    const m = await mount()
    expect(m.el.querySelector('[aria-label="Cargando movimientos"]')).toBeNull()
    expect(m.rows()).toHaveLength(3)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
    await act(async () => { release() })
  })

  it('says so when there are no movements', async () => {
    serve([])
    const m = await mount()
    expect(m.el.textContent).toContain('Todavía no hay movimientos de caja.')
    expect(m.status()).toBeNull()
  })
})

const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find(b => b.textContent === text)

// odd/tasks/ux-paginas.md S1-S3: a delete asks inside the app, confirms, and a failure says what happened.
describe('MovementsList delete and load errors', () => {
  async function withDelete(answer: () => Promise<Response>) {
    const all = movements(2)
    serve(all)
    const fetchMock = vi.mocked(fetch)
    const serveList = fetchMock.getMockImplementation()!
    const deletes: string[] = []
    fetchMock.mockImplementation(async (url, init) => {
      if (init?.method === 'DELETE') { deletes.push(String(url)); return answer() }
      return serveList(url, init)
    })
    const onChanged = vi.fn()
    const el = document.createElement('div')
    document.body.appendChild(el)
    root = createRoot(el)
    act(() => root!.render(<MovementsList refreshKey={0} onChanged={onChanged} />))
    await flush()
    return { el, deletes, onChanged }
  }

  it('asks next to the row instead of a native confirm, then deletes and says so', async () => {
    const nativeConfirm = vi.fn(() => true)
    vi.stubGlobal('confirm', nativeConfirm)
    const { el, deletes, onChanged } = await withDelete(async () => ({ ok: true, json: async () => ({}) }) as Response)
    act(() => el.querySelector<HTMLButtonElement>('button[aria-label="Borrar movimiento del 1 oct"]')!.click())
    expect(el.textContent).toContain('¿Borrás el movimiento del 1 oct?')
    expect(deletes).toEqual([])
    await act(async () => { button(el, 'Sí, borrar')!.click() })
    await flush()
    expect(nativeConfirm).not.toHaveBeenCalled()
    expect(deletes).toEqual(['/api/cash/movements/m1'])
    expect(toast.success).toHaveBeenCalledWith('Movimiento borrado')
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('a delete without connection says so in Spanish and changes nothing', async () => {
    const { el, onChanged } = await withDelete(async () => { throw new TypeError('Failed to fetch') })
    act(() => el.querySelector<HTMLButtonElement>('button[aria-label="Borrar movimiento del 1 oct"]')!.click())
    await act(async () => { button(el, 'Sí, borrar')!.click() })
    await flush()
    expect(el.querySelector('[role="alert"]')?.textContent).toBe('No hay conexión. Revisá tu internet y probá de nuevo.')
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('a failed load says so with Reintentar, never "no movements"', async () => {
    let fail = true
    vi.stubGlobal('fetch', vi.fn(async () => (fail ? { ok: false, status: 500, json: async () => ({}) } : { ok: true, json: async () => ({ data: movements(1), pagination: { total: 1 } }) })))
    const m = await mount()
    expect(m.el.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron cargar los movimientos.')
    expect(m.el.textContent).not.toContain('Todavía no hay movimientos de caja.')
    fail = false
    await act(async () => { button(m.el, 'Reintentar')!.click() })
    await flush()
    expect(m.rows()).toHaveLength(1)
    expect(m.el.textContent).not.toContain('No se pudieron cargar los movimientos.')
  })
})
