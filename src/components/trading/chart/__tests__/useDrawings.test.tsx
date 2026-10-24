import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import type { DrawingManager } from 'lightweight-charts-drawing'
import { fakeChart } from '@/lib/chart/__tests__/fake-chart'
import { useDrawings } from '../useDrawings'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

function Probe({ manager }: { manager: DrawingManager }) {
  useDrawings(manager, 'BTCUSDT')
  return null
}

async function render(loaded: unknown = { drawings: [] }) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    new Response(init?.method === 'PUT' ? '{}' : JSON.stringify(loaded)))
  vi.stubGlobal('fetch', fetchMock)
  const { manager } = fakeChart()
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<Probe manager={manager} />) })
  const puts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')
  return { manager, puts, fetchMock, unmount: () => act(() => root.unmount()) }
}

const hide = (event: 'visibilitychange' | 'pagehide') => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
  if (event === 'visibilitychange') document.dispatchEvent(new Event('visibilitychange'))
  else window.dispatchEvent(new Event('pagehide'))
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
}

describe('saving drawings when the app goes to the background (S8)', () => {
  it('a change waits the usual 600ms while the app is open, as a plain request', async () => {
    const { manager, puts, unmount } = await render()

    act(() => { manager.add({ kind: 'horizontal-line', points: [{ time: 100, price: 150 }] } as never) })
    expect(puts()).toHaveLength(0)

    await act(async () => { await new Promise(r => setTimeout(r, 650)) })
    expect(puts()).toHaveLength(1)
    // keepalive requests share a 64 KB budget: only the save on the way out uses it
    expect(puts()[0][1]?.keepalive).toBe(false)
    unmount()
  })

  it('a pending change is saved at once when the app is hidden, with keepalive', async () => {
    const { manager, puts, unmount } = await render()
    act(() => { manager.add({ kind: 'horizontal-line', points: [{ time: 100, price: 150 }] } as never) })

    hide('visibilitychange')

    expect(puts()).toHaveLength(1)
    const [, init] = puts()[0]
    expect(init?.keepalive).toBe(true)
    expect(JSON.parse(init?.body as string)).toMatchObject({ ticker: 'BTCUSDT', drawings: [{ kind: 'horizontal-line' }] })
    unmount()
  })

  it('the page being closed saves a pending change too, once', async () => {
    const { manager, puts, unmount } = await render()
    act(() => { manager.add({ kind: 'horizontal-line', points: [{ time: 100, price: 150 }] } as never) })

    hide('pagehide')
    hide('visibilitychange')

    expect(puts()).toHaveLength(1)
    unmount()
  })

  it('nothing pending, nothing saved', async () => {
    const { puts, unmount } = await render()

    hide('visibilitychange')

    expect(puts()).toHaveLength(0)
    unmount()
  })
})

describe('loading the drawings of a ticker (S2)', () => {
  it('a ticker never saved brings its legacy rows in the same response: no second request, saved once', async () => {
    const legacy = [{ id: 'r1', type: 'hline', points: [{ time: 100, price: 150 }], style: {} }]
    const { manager, puts, fetchMock, unmount } = await render({ drawings: null, legacy })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })

    expect(fetchMock.mock.calls.map(([u]) => String(u))).not.toContain('/api/drawings?ticker=BTCUSDT')
    expect(manager.drawings()).toHaveLength(1)
    expect(puts()).toHaveLength(1) // brought over to the new format once
    unmount()
  })

  it('a ticker with no drawings at all loads empty with one request', async () => {
    const { manager, fetchMock, unmount } = await render({ drawings: null, legacy: [] })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(manager.drawings()).toEqual([])
    unmount()
  })
})
