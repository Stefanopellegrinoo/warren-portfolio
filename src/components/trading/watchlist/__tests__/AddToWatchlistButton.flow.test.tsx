import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { toast } from 'sonner'
import { AddToWatchlistButton } from '../AddToWatchlistButton'
import { NO_CONNECTION } from '@/lib/request-errors'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); document.body.innerHTML = '' })

type Handler = () => Response | Promise<Response>
function stubFetch({ lists, add }: { lists?: Handler; add?: Handler }) {
  const calls: { url: string; body?: string }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? String(init.body) : undefined })
    if (url === '/api/watchlist/lists' && lists) return lists()
    if (url === '/api/watchlist' && add) return add()
    throw new Error(`unexpected fetch ${url}`)
  }))
  return calls
}

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.includes(text))

async function render(props: React.ComponentProps<typeof AddToWatchlistButton>) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<AddToWatchlistButton {...props} />) })
  return { el, unmount: () => act(() => root.unmount()) }
}

describe('AddToWatchlistButton — direct mode (a list is chosen)', () => {
  it('disables the button while the request is in flight', async () => {
    let answer!: (r: Response) => void
    const calls = stubFetch({ add: () => new Promise<Response>(r => { answer = r }) })
    const onAdded = vi.fn()
    const { unmount } = await render({ symbol: 'AAPL', watchlistId: 'w1', onAdded })

    act(() => button('Agregar a la lista')!.click())
    await flush()
    expect(button('Agregar a la lista')!.disabled).toBe(true)
    expect(JSON.parse(calls[0].body!)).toEqual({ symbol: 'AAPL', watchlistId: 'w1' })

    await act(async () => { answer(Response.json({ item: {} }, { status: 201 })) })
    await flush()
    expect(button('En la lista')).toBeDefined()
    expect(onAdded).toHaveBeenCalledWith('w1')
    unmount()
  })

  it('a refused add shows the server message and keeps the button usable', async () => {
    stubFetch({ add: () => Response.json({ error: 'No encontramos esa lista' }, { status: 404 }) })
    const onAdded = vi.fn()
    const { unmount } = await render({ symbol: 'AAPL', watchlistId: 'w1', onAdded })

    act(() => button('Agregar a la lista')!.click())
    await flush()

    expect(toast.error).toHaveBeenCalledWith('No encontramos esa lista')
    expect(button('Agregar a la lista')!.disabled).toBe(false)
    expect(onAdded).not.toHaveBeenCalled()
    unmount()
  })

  it('an add that never reached the server says there is no connection', async () => {
    stubFetch({ add: () => { throw new TypeError('Failed to fetch') } })
    const { unmount } = await render({ symbol: 'AAPL', watchlistId: 'w1' })

    act(() => button('Agregar a la lista')!.click())
    await flush()

    expect(toast.error).toHaveBeenCalledWith(NO_CONNECTION)
    unmount()
  })

  it('a 409 still counts as in the list', async () => {
    stubFetch({ add: () => Response.json({ error: 'Ese ticker ya está en la lista' }, { status: 409 }) })
    const { unmount } = await render({ symbol: 'AAPL', watchlistId: 'w1' })

    act(() => button('Agregar a la lista')!.click())
    await flush()

    expect(button('En la lista')).toBeDefined()
    expect(toast.error).not.toHaveBeenCalled()
    unmount()
  })
})

describe('AddToWatchlistButton — popover mode (pick a list)', () => {
  const openPopover = async () => {
    act(() => document.querySelector<HTMLButtonElement>('button[aria-label="Agregar AAPL a una lista"]')!.click())
    await flush()
  }

  it('a failed lists load says so with Reintentar, never "No tenés listas guardadas."', async () => {
    let attempt = 0
    stubFetch({ lists: () => (++attempt === 1 ? new Response('<html>500</html>', { status: 500 }) : Response.json({ lists: [{ id: 'w1', name: 'Mi lista' }] })) })
    const { unmount } = await render({ symbol: 'AAPL' })
    await openPopover()

    expect(document.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron cargar tus listas.')
    expect(document.body.textContent).not.toContain('No tenés listas guardadas.')

    act(() => button('Reintentar')!.click())
    await flush()

    expect(attempt).toBe(2)
    expect(button('Mi lista')).toBeDefined()
    unmount()
  })

  it('adding to a list confirms with a toast', async () => {
    stubFetch({ lists: () => Response.json({ lists: [{ id: 'w1', name: 'Mi lista' }] }), add: () => Response.json({ item: {} }, { status: 201 }) })
    const onAdded = vi.fn()
    const { unmount } = await render({ symbol: 'AAPL', onAdded })
    await openPopover()

    act(() => button('Mi lista')!.click())
    await flush()

    expect(toast.success).toHaveBeenCalledWith('Agregado a la lista', { description: 'Mi lista' })
    expect(onAdded).toHaveBeenCalledWith('w1')
    unmount()
  })

  it('a failed add says why, and the list button is disabled while in flight', async () => {
    let fail!: (e: Error) => void
    stubFetch({ lists: () => Response.json({ lists: [{ id: 'w1', name: 'Mi lista' }] }), add: () => new Promise<Response>((_, reject) => { fail = reject }) })
    const onAdded = vi.fn()
    const { unmount } = await render({ symbol: 'AAPL', onAdded })
    await openPopover()

    act(() => button('Mi lista')!.click())
    await flush()
    expect(button('Mi lista')!.disabled).toBe(true)

    await act(async () => { fail(new TypeError('Failed to fetch')) })
    await flush()

    expect(toast.error).toHaveBeenCalledWith(NO_CONNECTION)
    expect(button('Mi lista')!.disabled).toBe(false)
    expect(onAdded).not.toHaveBeenCalled()
    unmount()
  })
})
