import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import PortfolioList from '../portfolios/PortfolioList'
import { forgetCached } from '@/lib/client-cache'

// odd/tasks/ux-ons-y-operaciones.md S5: the list page, through the real component with the network stubbed.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// A request left hanging would stay in flight for the next test (the cache shares in-flight loads): end it.
const hanging: (() => void)[] = []
afterEach(async () => {
  hanging.splice(0).forEach((end) => end())
  await new Promise((r) => setTimeout(r, 0))
  document.body.innerHTML = ''; vi.unstubAllGlobals(); forgetCached()
})

const PORTFOLIOS = [
  { id: 'p1', name: 'Ingreso mensual en dólares', itemCount: 6, createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-20T12:00:00Z' },
  { id: 'p2', name: 'Corto plazo', itemCount: 1, createdAt: '2026-10-02T12:00:00Z', updatedAt: '2026-10-18T12:00:00Z' },
]
type Reply = { status: number; body?: unknown }
function stubFetch(portfolios: typeof PORTFOLIOS, write?: Reply, hang = false) {
  const fn = vi.fn(async (_url: string, init?: { method?: string }) => {
    if (hang) await new Promise<void>((end) => { hanging.push(end) })
    const r = init?.method === 'GET' || !write ? { status: 200, body: { portfolios, limits: { portfolios: 10, items: 20 } } } : write
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body }
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
async function mount() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  await act(async () => { createRoot(el).render(<PortfolioList />) })
  await flush()
  return el
}
const button = (el: Element, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!
const click = async (b: HTMLElement) => { await act(async () => { b.click() }); await flush() }
const alerts = (el: Element) => [...el.querySelectorAll('[role="alert"]')]

describe('PortfolioList (S5)', () => {
  it('lists the existing portfolios before the create action, which opens the name field on demand', async () => {
    stubFetch(PORTFOLIOS)
    const el = await mount()
    const text = el.textContent!
    expect(text.indexOf('Ingreso mensual en dólares')).toBeGreaterThan(-1)
    expect(text.indexOf('Corto plazo')).toBeLessThan(text.indexOf('Nueva cartera'))
    expect(el.querySelector('#pl-name')).toBeNull()
    await click(button(el, 'Nueva cartera'))
    expect(el.querySelector('#pl-name')).not.toBeNull()
  })

  it('with no portfolios the create form is right there', async () => {
    stubFetch([])
    const el = await mount()
    expect(el.textContent).toContain('Creá tu primera cartera')
    expect(el.querySelector('#pl-name')).not.toBeNull()
  })

  it('a failed create says why next to the form', async () => {
    stubFetch([], { status: 422, body: { error: 'Llegaste al máximo de 10 carteras' } })
    const el = await mount()
    const input = el.querySelector('#pl-name') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => { setter.call(input, 'Nueva'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await click(button(el, 'Crear'))
    expect(alerts(el)).toHaveLength(1)
    expect(alerts(el)[0].textContent).toBe('Llegaste al máximo de 10 carteras')
    expect(alerts(el)[0].parentElement!.contains(input)).toBe(true)
  })

  it('a failed delete says why on that portfolio\'s row', async () => {
    stubFetch(PORTFOLIOS, { status: 500, body: { error: 'No se pudo eliminar la cartera' } })
    const el = await mount()
    await click(el.querySelector('button[aria-label="Eliminar Corto plazo"]') as HTMLElement)
    await click(button(el, 'Sí, eliminar'))
    expect(alerts(el)).toHaveLength(1)
    expect(alerts(el)[0].closest('li')!.textContent).toContain('Corto plazo')
  })
})

describe('PortfolioList — seen before at once, a delete without asking again (odd/tasks/rendimiento.md S9)', () => {
  it('the list seen before shows at once while it refreshes', async () => {
    stubFetch(PORTFOLIOS)
    await mount()
    stubFetch(PORTFOLIOS, undefined, true)
    const el = await mount()
    expect(el.textContent).toContain('Corto plazo')
  })

  it('a deleted portfolio leaves the list without asking for it again', async () => {
    const fetch = stubFetch(PORTFOLIOS, { status: 204 })
    const el = await mount()
    await click(el.querySelector('button[aria-label="Eliminar Corto plazo"]') as HTMLElement)
    await click(button(el, 'Sí, eliminar'))
    expect(el.textContent).not.toContain('Corto plazo')
    expect(el.textContent).toContain('Ingreso mensual en dólares')
    expect(fetch.mock.calls.filter(([, i]) => (i?.method ?? 'GET') === 'GET')).toHaveLength(1)
  })
})
