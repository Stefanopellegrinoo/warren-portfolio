import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { forgetCached } from '@/lib/client-cache'
import StrategiesPage from '../page'

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// A request left hanging would stay in flight for the next test (the cache shares in-flight loads): end it.
const hanging: (() => void)[] = []
afterEach(async () => {
  hanging.splice(0).forEach(end => end())
  await new Promise(r => setTimeout(r, 0))
  vi.unstubAllGlobals(); forgetCached(); document.body.innerHTML = ''
})

const strategies = [{ id: 's1', name: 'Momentum', tickers: ['AAPL'], timeframes: ['1d'], active: true, indicator_setups: [{ id: 'u1', active: true }] }]

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
async function mount(hang = false) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (hang) await new Promise<void>(end => { hanging.push(end) })
    if (url === '/api/strategies') return new Response(JSON.stringify({ strategies }))
    throw new Error(`unexpected fetch ${url}`)
  }))
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<StrategiesPage />) })
  await flush()
  return { el, unmount: () => act(() => root.unmount()) }
}

describe('Strategies list: seen before in the tab (odd/tasks/rendimiento.md S9)', () => {
  it('shows the strategies at once while they refresh', async () => {
    const first = await mount()
    expect(first.el.textContent).toContain('Momentum')
    first.unmount()

    const { el, unmount } = await mount(true)
    expect(el.textContent).toContain('Momentum')
    expect(el.querySelector('[role="status"][aria-label="Cargando estrategias"]')).toBeNull()
    unmount()
  })
})
