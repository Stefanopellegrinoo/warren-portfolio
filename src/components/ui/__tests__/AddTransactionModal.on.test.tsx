import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import AddTransactionModal from '../AddTransactionModal'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
})
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find(b => b.textContent?.includes(text))!
function setValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}

async function openOnForm() {
  const calls: { url: string; body?: Record<string, unknown> }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url === '/api/on-positions') return new Response('{}', { status: 201 })
    if (url.startsWith('/api/ons/search')) return new Response(JSON.stringify({ results: [{ ticker: 'YM42D', name: 'YPF 2042', source: 'byma' }] }))
    return new Response('[]')
  }))
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<AddTransactionModal onClose={() => {}} onSuccess={() => {}} />) })
  await flush()
  act(() => button(el, 'Obligación negociable').click())
  await flush()
  return { el, calls, unmount: () => act(() => root.unmount()) }
}

describe('AddTransactionModal — ON form', () => {
  it('no longer offers "Cupón": ON coupons are automatic (S10)', async () => {
    const { el, unmount } = await openOnForm()
    const labels = [...el.querySelectorAll('input[name="tx-op"]')].map(i => i.parentElement!.textContent)
    expect(labels).toEqual(['Compra'])
    expect(el.textContent).not.toContain('Cupón')
    unmount()
  })

  it('still posts an ON buy', async () => {
    const { el, calls, unmount } = await openOnForm()
    setValue(el.querySelector<HTMLInputElement>('#tx-ticker')!, 'YM42')
    await act(async () => { await new Promise(r => setTimeout(r, 400)) })
    act(() => button(el, 'YPF 2042').click())
    setValue(el.querySelector<HTMLInputElement>('#tx-quantity')!, '10')
    setValue(el.querySelector<HTMLInputElement>('#tx-price')!, '98,5')
    await act(async () => { el.querySelector('form')!.requestSubmit() })
    await flush()
    const post = calls.find(c => c.url === '/api/on-positions')
    expect(post?.body).toMatchObject({ operation: 'COMPRA', quantity: 10, price: 98.5 })
    unmount()
  })
})
