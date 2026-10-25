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

// odd/tasks/chart-customization.md S6: the sheet saves a whole condition; an alert from before reads as the price against its value.
describe('useChartAlerts — conditions', () => {
  const ROW = { id: 'a1', ticker: 'AAPL', type: 'price', operator: 'crosses_above', value: 110, name: 'AAPL cruza por encima de 110,00', status: 'active' }
  function stub(rows: unknown[], write?: (method: string, body: Record<string, unknown>) => Response) {
    const calls: { url: string; method: string; body?: Record<string, unknown> }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ url, method, body })
      if (method === 'GET') return Response.json({ alerts: rows })
      return write!(method, body)
    }))
    return calls
  }

  it('an alert from before the conditions reads as the price against its value, with no color', async () => {
    stub([ROW])
    const { unmount } = await render()

    const { type: _type, ...fields } = ROW
    expect(api.alerts[0]).toEqual({ ...fields, source: 'price', target: 'value', timeframe: null, periods: null, color: null })
    unmount()
  })

  it('a new alert from the sheet: RSI 14 crosses 70 up on 1h, sent whole and named by its words', async () => {
    const calls = stub([], (_m, body) => Response.json({ alert: { id: 'a9', status: 'active', ...body } }, { status: 201 }))
    const { el, unmount } = await render()

    let saved: boolean | undefined
    await act(async () => { saved = await api.save(null, { source: 'rsi.rsi', operator: 'crosses_above', target: 'value', value: 70, timeframe: '1h', periods: { rsi: 14 }, color: '#089981' }) })

    expect(saved).toBe(true)
    expect(calls.at(-1)).toEqual({
      url: '/api/price-alerts', method: 'POST',
      body: { ticker: 'AAPL', type: 'price', source: 'rsi.rsi', operator: 'crosses_above', target: 'value', value: 70, timeframe: '1h', periods: { rsi: 14 }, color: '#089981', name: 'AAPL: RSI 14 cruza 70 (1h) · para arriba' },
    })
    expect(el.textContent).toBe('a9')
    expect(api.alerts[0]).toMatchObject({ source: 'rsi.rsi', color: '#089981', timeframe: '1h' })
    expect(toast.success).toHaveBeenCalledWith('Alerta creada', { description: 'AAPL: RSI 14 cruza 70 (1h) · para arriba' })
    unmount()
  })

  it('an edited alert: the price typed by hand and a color, sent whole, the list takes what the server kept', async () => {
    const calls = stub([ROW], (_m, body) => Response.json({ alert: { ...ROW, ...body } }))
    const { unmount } = await render()

    await act(async () => { await api.save('a1', { source: 'price', operator: 'crosses_above', target: 'value', value: 112.25, timeframe: null, periods: null, color: '#f23645' }) })

    expect(calls.at(-1)).toEqual({
      url: '/api/price-alerts/a1', method: 'PATCH',
      body: { source: 'price', operator: 'crosses_above', target: 'value', value: 112.25, timeframe: null, periods: null, color: '#f23645', name: 'AAPL cruza por encima de 112,25' },
    })
    expect(api.alerts[0]).toMatchObject({ value: 112.25, color: '#f23645', name: 'AAPL cruza por encima de 112,25' })
    expect(toast.success).toHaveBeenCalledWith('Alerta guardada')
    unmount()
  })

  it('a refused save keeps the list and says why', async () => {
    stub([ROW], () => Response.json({ error: 'Elegí un color de la paleta' }, { status: 400 }))
    const { unmount } = await render()

    let saved: boolean | undefined
    await act(async () => { saved = await api.save('a1', { source: 'price', operator: 'crosses', target: 'value', value: 1, timeframe: null, periods: null, color: 'x' }) })

    expect(saved).toBe(false)
    expect(api.alerts[0]).toMatchObject({ value: 110 })
    expect(toast.error).toHaveBeenCalledWith('No se pudo guardar la alerta', { description: 'Elegí un color de la paleta' })
    unmount()
  })

  it('dragging an alert that crosses either way keeps it either way', async () => {
    const calls = stub([{ ...ROW, operator: 'crosses', source: 'price', target: 'value' }], () => Response.json({ alert: {} }))
    const { unmount } = await render()

    await act(async () => { await api.move('a1', 90) })

    expect(calls.at(-1)!.body).toEqual({ value: 90, operator: 'crosses', name: 'AAPL: Precio cruza 90,00 · cualquiera' })
    unmount()
  })

  it('dragging a price alert still picks up or down by where it lands', async () => {
    const calls = stub([ROW], () => Response.json({ alert: {} }))
    const { unmount } = await render()

    await act(async () => { await api.move('a1', 90) })

    expect(calls.at(-1)!.body).toEqual({ value: 90, operator: 'crosses_below', name: 'AAPL cruza por debajo de 90,00' })
    unmount()
  })
})
