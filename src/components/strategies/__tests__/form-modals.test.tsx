import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { toast } from 'sonner'
import { StrategyFormModal } from '../StrategyFormModal'
import { SetupFormModal } from '../SetupFormModal'
import { NO_CONNECTION } from '@/lib/request-errors'
import type { IndicatorSetup } from '@/types'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { vi.unstubAllGlobals(); vi.mocked(toast.error).mockClear(); vi.mocked(toast.success).mockClear(); document.body.innerHTML = '' })

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!
  act(() => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}

const failures = {
  'the request never reached the server': () => { throw new TypeError('Failed to fetch') },
  'the server answered with its message': () => new Response(JSON.stringify({ error: 'Ya existe una estrategia con ese nombre.' }), { status: 400 }),
}

async function mount(node: React.ReactNode, respond: () => Response) {
  const fetchMock = vi.fn(async () => respond())
  vi.stubGlobal('fetch', fetchMock)
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(node) })
  await flush()
  const submit = async () => {
    await act(async () => { document.querySelector('form')!.requestSubmit() })
    await flush()
  }
  return { fetchMock, submit, unmount: () => act(() => root.unmount()) }
}

const alertText = () => document.querySelector('[role="alert"]')?.textContent

const setup: IndicatorSetup = {
  id: 'u1', strategy_id: 's1', user_id: 'x', name: 'Cruce EMA', active: true, created_at: '2026-10-01T00:00:00Z',
  config: { indicators: [{ type: 'EMA', period: 20 }], conditions: { buy: [], sell: [] } },
}

describe('StrategyFormModal: a failed save says what happened in Spanish', () => {
  it.each(Object.entries(failures))('%s', async (name, respond) => {
    const onSuccess = vi.fn()
    const { fetchMock, submit, unmount } = await mount(<StrategyFormModal open onOpenChange={() => {}} onSuccess={onSuccess} />, respond)
    setValue(document.querySelector<HTMLInputElement>('#strategy-name')!, 'Momentum')
    setValue(document.querySelector<HTMLTextAreaElement>('#strategy-philosophy')!, 'Seguir la tendencia')
    await submit()

    const expected = name === 'the request never reached the server' ? NO_CONNECTION : 'Ya existe una estrategia con ese nombre.'
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(alertText()).toBe(expected)
    expect(toast.error).toHaveBeenCalledWith(expected)
    expect(document.body.textContent).not.toContain('Failed to fetch')
    expect(onSuccess).not.toHaveBeenCalled()
    // The form stays open with the typed data and Guardar enabled again.
    expect(document.querySelector<HTMLInputElement>('#strategy-name')!.value).toBe('Momentum')
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false)
    unmount()
  })
})

describe('SetupFormModal: a failed save says what happened in Spanish', () => {
  it.each(Object.entries(failures))('%s', async (name, respond) => {
    const onSuccess = vi.fn()
    const { fetchMock, submit, unmount } = await mount(<SetupFormModal open onOpenChange={() => {}} strategyId="s1" setup={setup} onSuccess={onSuccess} />, respond)
    await submit()

    const expected = name === 'the request never reached the server' ? NO_CONNECTION : 'Ya existe una estrategia con ese nombre.'
    expect(fetchMock).toHaveBeenCalledWith('/api/strategies/s1/setups/u1', expect.objectContaining({ method: 'PUT' }))
    expect(alertText()).toBe(expected)
    expect(toast.error).toHaveBeenCalledWith(expected)
    expect(document.body.textContent).not.toContain('Failed to fetch')
    expect(onSuccess).not.toHaveBeenCalled()
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false)
    unmount()
  })
})
