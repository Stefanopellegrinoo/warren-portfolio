// odd/tasks/rendimiento.md S7: the value chart asks for the whole series once and cuts each period from it;
// a chart seen before in the tab shows at once.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { forgetCached } from '@/lib/client-cache'
import { argentinaDate } from '@/lib/utils'
import ValueChart from '../ValueChart'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const HISTORY = '/api/portfolio-history?days=all&universe=total'
const daysAgo = (n: number) => {
  const d = new Date(`${argentinaDate()}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}
const label = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
const SERIES = [200, 60, 10, 0].map((n, i) => ({ snapshot_date: daysAgo(n), value: 1000 + i, invested: 900 }))

let root: Root | null = null
afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  vi.unstubAllGlobals()
  forgetCached()
  document.body.innerHTML = ''
})

async function mount(answer: () => Promise<Response>) {
  const urls: string[] = []
  vi.stubGlobal('ResizeObserver', class {
    constructor(private cb: (entries: { contentRect: { width: number } }[]) => void) {}
    observe() { this.cb([{ contentRect: { width: 600 } }]) }
    disconnect() {}
  })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { urls.push(url); lastAsked = url; return answer() }))
  const el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  await act(async () => { root!.render(<ValueChart />) })
  await act(async () => {})
  return {
    el, urls,
    firstDay: () => el.querySelectorAll('svg text[text-anchor="start"]')[0]?.textContent,
    pick: (id: string) => act(() => { el.querySelector<HTMLInputElement>(`input[value="${id}"]`)!.click() }),
  }
}
let lastAsked = ''
const ok = async () => new Response(JSON.stringify({ data: SERIES }))

describe('ValueChart', () => {
  it('asks for the whole series once and cuts each period from it', async () => {
    const c = await mount(ok)
    expect(c.urls).toEqual([HISTORY])
    expect(c.firstDay()).toBe(label(daysAgo(60))) // 3M
    // Its second line is cost plus cash, not money put in (statistics-truth S9).
    expect(c.el.textContent).toContain('Costo + caja')
    expect(c.el.textContent).not.toContain('Invertido')
    await c.pick('1M')
    expect(c.firstDay()).toBe(label(daysAgo(10)))
    expect(c.el.querySelector('svg')?.getAttribute('aria-label')).toContain('período 1M')
    await c.pick('Todo')
    expect(c.firstDay()).toBe(label(daysAgo(200)))
    expect(c.urls).toEqual([HISTORY])
  })

  it('a chart seen before in the tab shows at once while it asks again', async () => {
    await mount(ok)
    act(() => root!.unmount())
    root = null
    let release!: (r: Response) => void
    const c = await mount(() => new Promise<Response>(r => { release = r }))
    expect(c.el.querySelector('[aria-label="Cargando historia"]')).toBeNull()
    expect(c.firstDay()).toBe(label(daysAgo(60)))
    expect(c.urls).toEqual([HISTORY])
    await act(async () => { release(new Response(JSON.stringify({ data: SERIES }))) })
  })

  it('a failed load says so with Reintentar, which shows the loading state until its answer', async () => {
    let release: ((r: Response) => void) | null = null
    let fail = true
    const c = await mount(() => (fail ? Promise.resolve(new Response('{}', { status: 500 })) : new Promise<Response>(r => { release = r })))
    expect(c.el.querySelector('[role="alert"]')?.textContent).toContain('No se pudo cargar la historia.')
    fail = false
    await act(async () => { [...c.el.querySelectorAll('button')].find(b => b.textContent === 'Reintentar')!.click() })
    expect(c.el.querySelector('[aria-label="Cargando historia"]')).not.toBeNull()
    expect(c.el.querySelector('[role="alert"]')).toBeNull()
    await act(async () => { release!(new Response(JSON.stringify({ data: SERIES }))) })
    expect(c.firstDay()).toBe(label(daysAgo(60)))
  })
})

describe('ValueChart — deposits recorded after the purchases they paid (odd/tasks/deposit-dates.md S1, S5)', () => {
  const withMoved = async () => new Response(JSON.stringify(lastAsked === '/api/cash/deposit-dates'
    ? { deposits: [], total: 0, from: null }
    : { data: SERIES, fundedDeposits: { amount: 1234.56, from: '2023-05-02' } }))

  it('says so in one quiet line under the chart, and its (i) offers to review the dates', async () => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
    const c = await mount(withMoved)
    expect(c.el.textContent).toContain('Algunos depósitos se adelantaron a la fecha de tus compras')
    await act(async () => { c.el.querySelector<HTMLButtonElement>('button[aria-label="Qué depósitos se adelantaron"]')!.click() })
    const review = [...document.body.querySelectorAll('button')].find(b => b.textContent === 'Revisar fechas de depósitos')!
    expect(review).toBeTruthy()
    await act(async () => { review.click() })
    await act(async () => {})
    expect(c.urls).toContain('/api/cash/deposit-dates')
    expect(document.body.querySelector('dialog[open]')?.textContent).toContain('Revisar fechas de depósitos')
  })

  it('says nothing when every deposit came before what it paid', async () => {
    const c = await mount(ok)
    expect(c.el.textContent).not.toContain('Algunos depósitos se adelantaron')
  })
})

