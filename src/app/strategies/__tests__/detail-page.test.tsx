import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { toast } from 'sonner'
import StrategyDetailPage from '../[id]/page'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 's1' }), useRouter: () => ({ push: vi.fn() }) }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.mocked(toast.success).mockClear(); vi.mocked(toast.error).mockClear(); document.body.innerHTML = '' })

const QUESTION = '¿Eliminar este setup? Esta acción no se puede deshacer.'
const strategy = {
  id: 's1', user_id: 'x', name: 'Momentum', philosophy: 'Seguir la tendencia', tickers: ['AAPL'], timeframes: ['1d'], active: true, created_at: '2026-10-01T00:00:00Z',
  indicator_setups: [{
    id: 'u1', strategy_id: 's1', user_id: 'x', name: 'Cruce EMA', active: true, created_at: '2026-10-01T00:00:00Z',
    config: { indicators: [{ type: 'EMA', period: 20 }], conditions: { buy: [], sell: [] } },
  }],
}

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text)

async function mount(deleteResponse: () => Response = () => new Response(null, { status: 204 })) {
  const calls: { url: string; method: string }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ url, method })
    if (url === '/api/strategies/s1' && method === 'GET') return new Response(JSON.stringify({ strategy }))
    if (url === '/api/strategies/s1/setups/u1' && method === 'DELETE') return deleteResponse()
    throw new Error(`unexpected fetch ${method} ${url}`)
  }))
  const confirmSpy = vi.spyOn(window, 'confirm')
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<StrategyDetailPage />) })
  await flush()
  const trigger = () => el.querySelector<HTMLButtonElement>('button[aria-label="Eliminar Cruce EMA"]')
  const deletes = () => calls.filter(c => c.method === 'DELETE')
  return { el, trigger, deletes, confirmSpy, unmount: () => act(() => root.unmount()) }
}

describe('Strategy detail: deleting a setup asks inside the app', () => {
  it('asks next to the action, and deletes only after "Sí, eliminar"', async () => {
    const { el, trigger, deletes, confirmSpy, unmount } = await mount()
    // The trigger keeps its icon-button look and its name.
    expect(trigger()!.className).toContain('hover:text-danger')
    expect(trigger()!.className).toContain('h-8 w-8')

    act(() => trigger()!.click())
    expect(el.querySelector(`[role="group"][aria-label="${QUESTION}"]`)!.textContent).toContain(QUESTION)
    expect(deletes()).toHaveLength(0)

    await act(async () => { button('Sí, eliminar')!.click() })
    await flush()
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(deletes()).toEqual([{ url: '/api/strategies/s1/setups/u1', method: 'DELETE' }])
    expect(el.textContent).not.toContain('Cruce EMA')
    expect(el.textContent).toContain('Esta estrategia todavía no tiene setups.')
    expect(toast.success).toHaveBeenCalledWith('Setup eliminado')
    unmount()
  })

  it('Cancelar keeps the setup and sends nothing', async () => {
    const { el, trigger, deletes, confirmSpy, unmount } = await mount()
    act(() => trigger()!.click())
    act(() => button('Cancelar')!.click())
    expect(deletes()).toHaveLength(0)
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(el.textContent).not.toContain(QUESTION)
    expect(trigger()).not.toBeNull()
    expect(el.textContent).toContain('Cruce EMA')
    unmount()
  })

  it('a failed delete still says so and keeps the setup', async () => {
    const { el, trigger, deletes, unmount } = await mount(() => new Response('{}', { status: 500 }))
    act(() => trigger()!.click())
    await act(async () => { button('Sí, eliminar')!.click() })
    await flush()
    expect(deletes()).toHaveLength(1)
    expect(toast.error).toHaveBeenCalledWith('No se pudo eliminar el setup')
    expect(toast.success).not.toHaveBeenCalled()
    expect(el.textContent).toContain('Cruce EMA')
    expect(trigger()!.disabled).toBe(false)
    unmount()
  })
})
