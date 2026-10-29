import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { forgetCached } from '@/lib/client-cache'
import DepositDatesDialog from '../DepositDatesDialog'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false }
})
afterEach(() => { vi.unstubAllGlobals(); forgetCached(); document.body.innerHTML = '' })

const PROPOSAL = {
  deposits: [{
    id: 'c40e252b-0b57-4aad-b679-63fbf1b2bcb1', date: '2026-03-31', amount: 165000, remaining: 73688.2649,
    parts: [{ date: '2022-02-09', amount: 2723.3 }, { date: '2022-03-02', amount: 2845.92 }],
  }],
  total: 5569.22,
  from: '2022-02-09',
}

function stub(post: () => Response = () => new Response(JSON.stringify({ saved: 2 }))) {
  const calls: { url: string; init?: RequestInit }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return init?.method === 'POST' ? post() : new Response(JSON.stringify(PROPOSAL))
  }))
  return calls
}

async function mount(onDone = vi.fn()) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<DepositDatesDialog open onClose={() => {}} onDone={onDone} />) })
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  return { el, onDone, unmount: () => act(() => root.unmount()) }
}
const text = (el: HTMLElement) => el.textContent!.replace(/ /g, ' ')

describe('DepositDatesDialog (odd/tasks/deposit-dates.md S2, S3)', () => {
  it('shows each deposit, the days it paid and what stays on its date, before saving anything', async () => {
    const calls = stub()
    const { el, unmount } = await mount()
    expect(calls.map(c => c.init?.method ?? 'GET')).toEqual(['GET'])
    expect(text(el)).toContain('Tu depósito del 31/03/2026 pagó compras desde el 09/02/2022: ¿lo repartimos en esas fechas?')
    const dates = [...el.querySelectorAll<HTMLInputElement>('input[type="date"]')]
    expect(dates.map(d => d.value)).toEqual(['2022-02-09', '2022-03-02'])
    // A part can move, but never to its deposit's day or later.
    expect(dates.every(d => d.max === '2026-03-30')).toBe(true)
    expect(text(el)).toContain('US$ 2.723,30')
    expect(text(el)).toContain('Queda el 31/03/2026: US$ 73.688,26')
    expect(text(el)).toContain('El total depositado no cambia.')
    unmount()
  })

  it('saves the proposal with the dates the user changed, then says so', async () => {
    const calls = stub()
    const { el, onDone, unmount } = await mount()
    const first = el.querySelector<HTMLInputElement>('input[type="date"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(first, '2022-02-01')
      first.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { el.querySelector<HTMLFormElement>('form')!.requestSubmit() })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })

    const post = calls.find(c => c.init?.method === 'POST')!
    expect(post.url).toBe('/api/cash/deposit-dates')
    expect(JSON.parse(String(post.init!.body))).toEqual({
      deposits: [{ id: PROPOSAL.deposits[0].id, parts: [{ date: '2022-02-01', amount: 2723.3 }, { date: '2022-03-02', amount: 2845.92 }] }],
    })
    expect(el.querySelector('[role="status"]')?.textContent).toBe('Listo: guardamos 2 fechas. El total depositado no cambió.')
    expect(onDone).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('a refusal shows the server\'s reason and saves nothing', async () => {
    stub(() => new Response(JSON.stringify({ error: 'Tus movimientos cambiaron desde que se armó la propuesta: revisala de nuevo.' }), { status: 409 }))
    const { el, onDone, unmount } = await mount()
    await act(async () => { el.querySelector<HTMLFormElement>('form')!.requestSubmit() })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(el.querySelector('[role="alert"]')?.textContent).toBe('Tus movimientos cambiaron desde que se armó la propuesta: revisala de nuevo.')
    expect(onDone).not.toHaveBeenCalled()
    unmount()
  })

  it('an answer without deposits says the proposal could not be made, instead of breaking', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }))))
    const { el, unmount } = await mount()
    expect(el.querySelector('[role="alert"]')?.textContent).toBe('No se pudo armar la propuesta.')
    unmount()
  })

  it('with nothing to review it says so and offers nothing to save', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ deposits: [], total: 0, from: null }))))
    const { el, unmount } = await mount()
    expect(text(el)).toContain('Tus depósitos ya están en fecha: no hay nada para revisar.')
    expect([...el.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Cerrar'])
    unmount()
  })
})
