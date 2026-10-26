// odd/tasks/ux-paginas.md S1: a list request that never reached the server says there is no connection.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { toast } from 'sonner'
import { WatchlistSelector } from '../WatchlistSelector'
import { NO_CONNECTION } from '@/lib/request-errors'
import { useChartStore } from '@/lib/store/chart-store'

// Node 25 ships a stub localStorage without methods; the persisted store needs a real one.
vi.hoisted(() => {
  const data = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), clear: () => data.clear() },
  })
})

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); document.body.innerHTML = '' })

describe('WatchlistSelector', () => {
  it('a failed list load without connection names the action and says there is no connection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => { root.render(<WatchlistSelector />) })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(toast.error).toHaveBeenCalledWith('No se pudieron cargar las listas', { description: NO_CONNECTION })
    act(() => root.unmount())
  })
})

describe('WatchlistSelector — Cartera', () => {
  async function open() {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ lists: [{ id: 'w1', name: 'Mi lista', item_count: 1 }] })))
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => { root.render(<WatchlistSelector />) })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    const trigger = el.querySelector('button')!
    await act(async () => { trigger.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    return { el, unmount: () => act(() => root.unmount()) }
  }
  const items = () => [...document.querySelectorAll('[role="menuitem"]')]

  it('is the first list, before Lista local, and cannot be renamed or deleted', async () => {
    const { unmount } = await open()

    expect(items().map((i) => i.textContent?.trim().split(/\s/)[0])).toEqual(['Cartera', 'Lista', 'Mi'])
    expect(items()[0].querySelector('button')).toBeNull()
    unmount()
  })

  it('choosing it makes it the current list, named on the button', async () => {
    const { el, unmount } = await open()

    await act(async () => { (items()[0] as HTMLElement).click() })

    expect(useChartStore.getState().activeWatchlistId).toBe('__cartera__')
    expect(el.querySelector('button')!.textContent).toContain('Cartera')
    unmount()
  })
})
