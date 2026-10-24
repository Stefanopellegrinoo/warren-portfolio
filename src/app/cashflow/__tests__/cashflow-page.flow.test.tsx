// odd/tasks/ux-paginas.md T1 (S1-S4): the Gastos page says what happened, confirms the delete
// inside the app and reads dates in Argentina time.
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { renderToStaticMarkup } from 'react-dom/server'
import { toast } from 'sonner'
import type { Cashflow } from '@/types'
import { NO_CONNECTION } from '@/lib/request-errors'
import { forgetCached } from '@/lib/client-cache'
import CashflowPage from '../page'
import ExpenseDialog from '../ExpenseDialog'
import ExpenseList from '../ExpenseList'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
// recharts needs ResizeObserver, which jsdom lacks; the trend chart is not under test here.
vi.mock('../MonthlyTrend', () => ({ default: () => null }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
  forgetCached()
  document.body.innerHTML = ''
})

const item = (over: Partial<Cashflow>): Cashflow => ({
  id: 'a', user_id: 'u', date: '2026-10-05', category: 'Supermercado', description: 'Coto',
  amount_usd: 100, status: 'PAGADO', created_at: '2026-10-05', ...over,
})
const PAID = item({})
const PENDING = item({ id: 'b', category: 'Alquiler', date: '2099-01-10', status: 'PENDIENTE' })
const PAID_TOGGLE = 'Pagado. Marcar como pendiente'
const PENDING_TOGGLE = 'Pendiente. Marcar como pagado'
const PAID_DELETE = 'Borrar gasto Supermercado del 05/10/2026'
const PENDING_DELETE = 'Borrar gasto Alquiler del 10/01/2099'

type Call = { method: string; body?: Record<string, unknown> }
type Reply = () => Response | Promise<Response>
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const byLabel = (el: HTMLElement, label: string) => el.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
const allByLabel = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>(`[aria-label="${label}"]`)]
const byText = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find(b => b.textContent === text)
const click = (b: HTMLElement | undefined) => act(() => { b!.click() })

async function mountPage({ load, write }: { load?: Reply; write?: Reply } = {}) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (method === 'GET') return load ? load() : json({ data: [PAID, PENDING], totalPending: 100, overdueCount: 0 })
    return write ? write() : json({ ok: true })
  }))
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<CashflowPage />) })
  await flush()
  if (byText(el, 'Ver todos los meses')) click(byText(el, 'Ver todos los meses'))
  return {
    el, calls, writes: () => calls.filter(c => c.method !== 'GET'), loads: () => calls.filter(c => c.method === 'GET').length,
    unmount: () => act(() => root.unmount()),
  }
}

describe('Gastos: toggling the status', () => {
  // odd/tasks/rendimiento.md S7: the answer carries the updated list, so the page asks for nothing else.
  it('sends the new status, confirms it and shows the list the answer carries, without asking for it again', async () => {
    const toggled = { ...PAID, status: 'PENDIENTE' as const }
    const { el, writes, loads } = await mountPage({ write: () => json({ ...toggled, list: { data: [toggled, PENDING], totalPending: 200, overdueCount: 0 } }) })
    click(byLabel(el, PAID_TOGGLE))
    await flush()
    expect(writes()).toEqual([{ method: 'PATCH', body: { id: 'a', status: 'PENDIENTE' } }])
    expect(toast.success).toHaveBeenCalledWith('Marcado como pendiente')
    expect(loads()).toBe(1)
    expect(allByLabel(el, PAID_TOGGLE)).toEqual([])
    expect(allByLabel(el, PENDING_TOGGLE).length).toBeGreaterThan(0)
  })

  it('reloads the list when the answer does not carry it', async () => {
    const { el, writes, loads } = await mountPage()
    click(byLabel(el, PENDING_TOGGLE))
    await flush()
    expect(writes()[0]).toEqual({ method: 'PATCH', body: { id: 'b', status: 'PAGADO' } })
    expect(toast.success).toHaveBeenCalledWith('Marcado como pagado')
    expect(loads()).toBe(2)
  })

  it('shows the server message when the change fails', async () => {
    const { el, loads } = await mountPage({ write: () => json({ error: 'No encontramos ese gasto' }, 404) })
    click(byLabel(el, PAID_TOGGLE))
    await flush()
    expect(toast.error).toHaveBeenCalledWith('No encontramos ese gasto')
    expect(toast.success).not.toHaveBeenCalled()
    expect(loads()).toBe(1)
  })

  it('says there is no connection when the request never reached the server', async () => {
    const { el } = await mountPage({ write: () => { throw new TypeError('Failed to fetch') } })
    click(byLabel(el, PAID_TOGGLE))
    await flush()
    expect(toast.error).toHaveBeenCalledWith(NO_CONNECTION)
    expect(el.textContent).not.toContain('Failed to fetch')
  })

  it("disables only that row's buttons while the request is in flight", async () => {
    let release!: (r: Response) => void
    const { el } = await mountPage({ write: () => new Promise<Response>(r => { release = r }) })
    click(byLabel(el, PAID_TOGGLE))
    await flush()
    for (const b of [...allByLabel(el, PAID_TOGGLE), ...allByLabel(el, PAID_DELETE)]) expect(b.disabled).toBe(true)
    for (const b of [...allByLabel(el, PENDING_TOGGLE), ...allByLabel(el, PENDING_DELETE)]) expect(b.disabled).toBe(false)

    await act(async () => { release(json({})) })
    await flush()
    for (const b of [...allByLabel(el, PAID_TOGGLE), ...allByLabel(el, PAID_DELETE)]) expect(b.disabled).toBe(false)
  })
})

describe('Gastos: deleting', () => {
  it('asks inside the app with the same question, never with confirm()', async () => {
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)
    const { el, writes } = await mountPage()
    click(byLabel(el, PAID_DELETE))
    expect(el.textContent).toContain('¿Eliminar este gasto?')
    expect(writes()).toEqual([])
    expect(confirm).not.toHaveBeenCalled()

    click(byText(el, 'Sí, borrar'))
    await flush()
    expect(writes()).toEqual([{ method: 'DELETE', body: { id: 'a' } }])
    expect(toast.success).toHaveBeenCalledWith('Gasto borrado')
  })

  it('shows the list the answer carries, without the deleted expense and without asking again', async () => {
    const { el, loads } = await mountPage({ write: () => json({ ok: true, list: { data: [PENDING], totalPending: 100, overdueCount: 0 } }) })
    click(byLabel(el, PAID_DELETE))
    click(byText(el, 'Sí, borrar'))
    await flush()
    expect(loads()).toBe(1)
    expect(allByLabel(el, PAID_DELETE)).toEqual([])
    expect(allByLabel(el, PENDING_DELETE).length).toBeGreaterThan(0)
  })

  it('sends nothing when the question is cancelled', async () => {
    const { el, writes } = await mountPage()
    click(byLabel(el, PAID_DELETE))
    click(byText(el, 'Cancelar'))
    await flush()
    expect(writes()).toEqual([])
    expect(el.textContent).not.toContain('¿Eliminar este gasto?')
  })

  it('says the delete failed when the server answers an error page', async () => {
    const { el } = await mountPage({ write: () => new Response('<html>502</html>', { status: 502 }) })
    click(byLabel(el, PAID_DELETE))
    click(byText(el, 'Sí, borrar'))
    await flush()
    expect(toast.error).toHaveBeenCalledWith('No se pudo borrar el gasto')
    expect(toast.success).not.toHaveBeenCalled()
  })
})

describe('Gastos: loading', () => {
  // odd/tasks/rendimiento.md S7: a page seen before in the tab shows its last data at once and refreshes behind.
  it('a visit after the first shows the last list at once while it asks again', async () => {
    const first = await mountPage()
    first.unmount()
    let release!: (r: Response) => void
    const { el, loads } = await mountPage({ load: () => new Promise<Response>(r => { release = r }) })
    expect(el.querySelector('[aria-label="Cargando gastos"]')).toBeNull()
    expect(allByLabel(el, PAID_DELETE).length).toBeGreaterThan(0)
    expect(loads()).toBe(1)
    await act(async () => { release(json({ data: [PAID] })) })
  })

  it('keeps saying the load failed, with Reintentar, instead of an empty list', async () => {
    let fail = true
    const { el, loads } = await mountPage({ load: () => (fail ? json({ error: 'x' }, 500) : json({ data: [PAID] })) })
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron cargar los gastos.')
    expect(el.textContent).not.toContain('Sin gastos en este período.')

    fail = false
    click(byText(el, 'Reintentar'))
    await flush()
    expect(loads()).toBe(2)
    expect(el.querySelector('[role="alert"]')).toBeNull()
  })

  it('says there is no connection when the load never reached the server', async () => {
    const { el } = await mountPage({ load: () => { throw new TypeError('Failed to fetch') } })
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(NO_CONNECTION)
    expect(byText(el, 'Reintentar')).toBeDefined()
  })
})

describe('ExpenseDialog: saving', () => {
  async function save(reply: Reply) {
    const calls: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => { calls.push(JSON.parse(String(init!.body))); return reply() }))
    const onSaved = vi.fn()
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => { root.render(<ExpenseDialog open onClose={() => {}} onSaved={onSaved} />) })
    const amount = el.querySelector<HTMLInputElement>('#expense-amount')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(amount, '50')
      amount.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { el.querySelector('form')!.requestSubmit() })
    await flush()
    return { el, calls, onSaved }
  }

  it('confirms the save with a toast', async () => {
    const { calls, onSaved } = await save(() => json({ id: 'n' }, 201))
    expect(calls).toHaveLength(1)
    expect(toast.success).toHaveBeenCalledWith('Gasto guardado')
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('still shows the server message next to the form', async () => {
    const { el, onSaved } = await save(() => json({ error: 'El monto tiene que ser mayor a 0' }, 400))
    expect(el.querySelector('#expense-error')?.textContent).toBe('El monto tiene que ser mayor a 0')
    expect(toast.success).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('says there is no connection when the save never reached the server', async () => {
    const { el } = await save(() => { throw new TypeError('Failed to fetch') })
    expect(el.querySelector('#expense-error')?.textContent).toBe(NO_CONNECTION)
    expect(toast.success).not.toHaveBeenCalled()
  })
})

describe('Gastos: dates in Argentina time', () => {
  // 23:30 in Buenos Aires is already the 25th in UTC.
  const lateNight = () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-24T23:30:00-03:00')) }

  it("defaults a new expense to today's date in Argentina", () => {
    lateNight()
    const html = renderToStaticMarkup(<ExpenseDialog open={false} onClose={() => {}} onSaved={() => {}} />)
    expect(html).toContain('value="2026-10-24"')
  })

  it('does not call an expense due today overdue until the day is over', () => {
    lateNight()
    const html = renderToStaticMarkup(
      <ExpenseList
        items={[item({ id: 't', status: 'PENDIENTE', date: '2026-10-24' }), item({ id: 'y', status: 'PENDIENTE', date: '2026-10-23', category: 'Salud' })]}
        sort={{ key: 'date', dir: 'desc' }} onSort={() => {}} onToggle={() => {}} onDelete={() => {}}
      />,
    )
    expect(html).toContain(`aria-label="${PENDING_TOGGLE}"`)
    expect(html).toContain('aria-label="Vencido. Marcar como pagado"')
    expect(html.match(/Vencido\. Marcar/g)).toHaveLength(2) // the 23rd only, in the table and the phone list
  })
})
