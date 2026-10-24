import { describe, it, expect, vi, afterEach } from 'vitest'
import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { toast } from 'sonner'
import { useChartAlerts } from '../useChartAlerts'
import { NO_CONNECTION } from '@/lib/request-errors'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); document.body.innerHTML = '' })

const ALERT = { id: 'a1', ticker: 'AAPL', operator: 'above', value: 110, name: 'AAPL > 110', status: 'active' }

function stubFetch(action?: () => Response | Promise<Response>) {
  const calls: { url: string; method: string }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ url, method })
    if (method === 'GET') return Response.json({ alerts: [ALERT] })
    if (action) return action()
    throw new Error(`unexpected fetch ${method} ${url}`)
  }))
  return calls
}

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

type Api = ReturnType<typeof useChartAlerts>
let api: Api
function Probe({ onApi }: { onApi: (a: Api) => void }) {
  const a = useChartAlerts('AAPL', 100)
  useEffect(() => onApi(a))
  return <p>{a.alerts.map(x => x.id).join(',')}</p>
}

async function render() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<Probe onApi={(a) => { api = a }} />) })
  await flush()
  return { el, unmount: () => act(() => root.unmount()) }
}

describe('useChartAlerts — remove', () => {
  it('confirms a removed alert with a toast', async () => {
    const calls = stubFetch(() => Response.json({ success: true }))
    const { el, unmount } = await render()

    await act(async () => { await api.remove('a1') })

    expect(calls.at(-1)).toEqual({ url: '/api/price-alerts/a1', method: 'DELETE' })
    expect(toast.success).toHaveBeenCalledWith('Alerta eliminada')
    expect(el.textContent).toBe('')
    unmount()
  })

  it('a remove that never reached the server says there is no connection, not "Failed to fetch"', async () => {
    stubFetch(() => { throw new TypeError('Failed to fetch') })
    const { el, unmount } = await render()

    await act(async () => { await api.remove('a1') })

    expect(toast.error).toHaveBeenCalledWith('No se pudo eliminar la alerta', { description: NO_CONNECTION })
    expect(toast.success).not.toHaveBeenCalled()
    expect(el.textContent).toBe('a1')
    unmount()
  })
})

describe('useChartAlerts — create and move', () => {
  it('a failure without a server message says "Probá de nuevo.", never "Error 500"', async () => {
    stubFetch(() => new Response('<html>500</html>', { status: 500 }))
    const { unmount } = await render()

    await act(async () => { await api.create(120) })

    expect(toast.error).toHaveBeenCalledWith('No se pudo crear la alerta', { description: 'Probá de nuevo.' })
    unmount()
  })

  it('a refused move shows the server message', async () => {
    stubFetch(() => Response.json({ error: 'El valor tiene que ser positivo' }, { status: 400 }))
    const { unmount } = await render()

    let moved: boolean | undefined
    await act(async () => { moved = await api.move('a1', 105) })

    expect(moved).toBe(false)
    expect(toast.error).toHaveBeenCalledWith('No se pudo mover la alerta', { description: 'El valor tiene que ser positivo' })
    unmount()
  })

  it('a created alert still confirms with "Alerta creada"', async () => {
    stubFetch(() => Response.json({ alert: { ...ALERT, id: 'a2', value: 120 } }, { status: 201 }))
    const { el, unmount } = await render()

    await act(async () => { await api.create(120) })

    expect(toast.success).toHaveBeenCalledWith('Alerta creada', { description: expect.any(String) })
    expect(el.textContent).toBe('a1,a2')
    unmount()
  })
})
