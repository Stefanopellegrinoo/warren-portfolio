import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import AddTransactionModal from '../AddTransactionModal'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeAll(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
})
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

type Fx = { mep: { rate: number; date: string } | null; ccl: { rate: number; date: string } | null }
const FX: Record<string, Fx> = {
  '2026-10-17': { mep: { rate: 1550.8, date: '2026-10-17' }, ccl: { rate: 1636.55, date: '2026-10-17' } },
  '2026-10-19': { mep: { rate: 1550.8, date: '2026-10-17' }, ccl: { rate: 1636.55, date: '2026-10-17' } },
  '2026-10-20': { mep: { rate: 1500, date: '2026-10-20' }, ccl: { rate: 1600, date: '2026-10-20' } },
}

function stubFetch() {
  const calls: { url: string; body?: Record<string, unknown> }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url === '/api/cedears') return new Response(JSON.stringify([{ ticker: 'AAPL', nombre: 'Apple', ratio: 20 }]))
    if (url === '/api/activos') return new Response('[]')
    if (url.startsWith('/api/fx?date=')) {
      const fx = FX[url.slice('/api/fx?date='.length)]
      return fx ? new Response(JSON.stringify(fx)) : new Response('{}', { status: 404 })
    }
    if (url === '/api/transactions') return new Response(JSON.stringify({ transaction: { id: 't' } }), { status: 201 })
    if (url === '/api/on-positions' || url === '/api/cash') return new Response('{}', { status: 201 })
    if (url.startsWith('/api/ons/search')) return new Response('[]')
    throw new Error(`unexpected fetch ${url}`)
  }))
  return calls
}

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

function setValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}
const byId = (el: HTMLElement, id: string) => el.querySelector<HTMLInputElement>(`#${id}`)!
const button = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll('button')].find(b => b.textContent?.includes(text))!

async function openCedearForm(onSuccess = () => {}) {
  const calls = stubFetch()
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<AddTransactionModal onClose={() => {}} onSuccess={onSuccess} />) })
  await flush()
  act(() => button(el, 'CEDEAR').click())
  await flush()
  setValue(byId(el, 'tx-date'), '2026-10-20')
  await flush()
  setValue(byId(el, 'tx-ticker'), 'AAP')
  act(() => button(el, 'Apple').click())
  return { el, calls, unmount: () => act(() => root.unmount()) }
}

describe('AddTransactionModal — CEDEAR broker ticket', () => {
  it('offers the three settlement currencies as one segmented control', async () => {
    const { el, unmount } = await openCedearForm()
    const labels = [...el.querySelectorAll('input[name="tx-currency"]')].map(i => i.parentElement!.textContent)
    expect(labels).toEqual(['Pesos', 'Dólar MEP', 'Dólar cable'])
    unmount()
  })

  it('shows the MEP and CCL of the trade date, and refetches when the date changes', async () => {
    const { el, calls, unmount } = await openCedearForm()
    expect(el.textContent).toContain('Dólar MEP del 20/10: 1.500,00 · CCL: 1.600,00')
    setValue(byId(el, 'tx-date'), '2026-10-17')
    await flush()
    expect(calls.some(c => c.url === '/api/fx?date=2026-10-17')).toBe(true)
    expect(el.textContent).toContain('Dólar MEP del 17/10: 1.550,80 · CCL: 1.636,55')
    unmount()
  })

  it('says which date the FX comes from when the trade date had none', async () => {
    const { el, unmount } = await openCedearForm()
    setValue(byId(el, 'tx-date'), '2026-10-19')
    await flush()
    expect(el.textContent).toContain('Dólar MEP del 17/10')
    expect(el.textContent).toContain('El 19/10 no tiene cotización: se usa la del 17/10.')
    unmount()
  })

  it('previews the equivalent shares and the USD-CCL price per share', async () => {
    const { el, unmount } = await openCedearForm()
    setValue(byId(el, 'tx-quantity'), '40')
    setValue(byId(el, 'tx-price'), '16000')
    expect(el.textContent).toContain('Equivale a 2,0000 acciones')
    // 16000 ARS × 20 / 1600 CCL = US$ 200 per share
    expect(el.textContent).toContain('US$ 200,00')
    unmount()
  })

  it('sends the raw ticket, not client-converted values, and never calls dolarapi', async () => {
    const { el, calls, unmount } = await openCedearForm()
    act(() => (el.querySelector('input[name="tx-currency"][value="MEP"]') as HTMLInputElement).click())
    setValue(byId(el, 'tx-quantity'), '40')
    setValue(byId(el, 'tx-price'), '10')
    setValue(byId(el, 'tx-commission'), '1.5')
    await act(async () => { el.querySelector('form')!.requestSubmit() })
    await flush()
    const post = calls.find(c => c.url === '/api/transactions')!
    expect(post.body).toEqual({
      date: '2026-10-20', ticker: 'AAPL', operation: 'COMPRA', assetType: 'CEDEAR',
      tradeCurrency: 'MEP', tradeQuantity: 40, tradePrice: 10, tradeCommission: 1.5, notes: '',
    })
    expect(calls.some(c => c.url.includes('dolarapi'))).toBe(false)
    unmount()
  })

  it('sends only the FX the user edited', async () => {
    const { el, calls, unmount } = await openCedearForm()
    act(() => button(el, 'Editar').click())
    setValue(byId(el, 'tx-fx-ccl'), '1650')
    setValue(byId(el, 'tx-quantity'), '40')
    setValue(byId(el, 'tx-price'), '16000')
    await act(async () => { el.querySelector('form')!.requestSubmit() })
    await flush()
    const post = calls.find(c => c.url === '/api/transactions')!
    expect(post.body).toMatchObject({ tradeCurrency: 'ARS', fxCcl: 1650 })
    expect(post.body).not.toHaveProperty('fxMep')
    unmount()
  })
})

type Initial = React.ComponentProps<typeof AddTransactionModal>['initialData']
async function openForm(choose: { initialData: Initial } | { option: string }) {
  const calls = stubFetch()
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  const initialData = 'initialData' in choose ? choose.initialData : undefined
  await act(async () => { root.render(<AddTransactionModal onClose={() => {}} onSuccess={() => {}} initialData={initialData} />) })
  await flush()
  if ('option' in choose) { act(() => button(el, choose.option).click()); await flush() }
  const submit = async () => {
    await act(async () => { el.querySelector('form')!.requestSubmit() })
    await flush()
  }
  return { el, calls, submit, unmount: () => act(() => root.unmount()) }
}

describe('AddTransactionModal — numbers typed the Argentine way', () => {
  it('reads a CEDEAR peso price "28.080" as 28080 in the preview and the POST', async () => {
    const { el, calls, unmount } = await openCedearForm()
    setValue(byId(el, 'tx-quantity'), '20')
    setValue(byId(el, 'tx-price'), '28.080')
    setValue(byId(el, 'tx-commission'), '1.234,5')
    // 28080 ARS × 20 / 1600 CCL = US$ 351 per share
    expect(el.textContent).toContain('US$\u00a0351,00')
    await act(async () => { el.querySelector('form')!.requestSubmit() })
    await flush()
    expect(calls.find(c => c.url === '/api/transactions')!.body).toMatchObject({
      tradeCurrency: 'ARS', tradeQuantity: 20, tradePrice: 28080, tradeCommission: 1234.5,
    })
    unmount()
  })

  it('reads an edited CCL "1.650,5" as 1650.5', async () => {
    const { el, calls, unmount } = await openCedearForm()
    act(() => button(el, 'Editar').click())
    expect(byId(el, 'tx-fx-ccl').value).toBe('1600')
    setValue(byId(el, 'tx-fx-ccl'), '1.650,5')
    setValue(byId(el, 'tx-quantity'), '40')
    setValue(byId(el, 'tx-price'), '16000')
    await act(async () => { el.querySelector('form')!.requestSubmit() })
    await flush()
    expect(calls.find(c => c.url === '/api/transactions')!.body).toMatchObject({ fxCcl: 1650.5 })
    unmount()
  })

  it('stock quick sell: prefills the position, reads "1.234,5" and a plain "6.69"', async () => {
    const { el, calls, submit, unmount } = await openForm({ initialData: { assetClass: 'ACCION', ticker: 'AAPL', quantity: 2.5, price: 190.7 } })
    expect(byId(el, 'tx-quantity').value).toBe('2,5')
    expect(byId(el, 'tx-price').value).toBe('190,7')
    setValue(byId(el, 'tx-price'), '1.234,5')
    setValue(byId(el, 'tx-commission'), '6.69')
    await submit()
    expect(calls.find(c => c.url === '/api/transactions')!.body).toMatchObject({ quantity: 2.5, price: 1234.5, commission: 6.69 })
    unmount()
  })

  it('ON quick sell: reads "1.050,5" and a plain "10"', async () => {
    const { el, calls, submit, unmount } = await openForm({ initialData: { assetClass: 'ON', ticker: 'AAA', quantity: 200, price: 98.5 } })
    setValue(byId(el, 'tx-quantity'), '10')
    setValue(byId(el, 'tx-price'), '1.050,5')
    await submit()
    expect(calls.find(c => c.url === '/api/on-positions')!.body).toMatchObject({ ticker: 'AAA', quantity: 10, price: 1050.5 })
    unmount()
  })

  it('cash: reads "1.234,50" as 1234.5', async () => {
    const { el, calls, submit, unmount } = await openForm({ option: 'Caja en dólares' })
    setValue(byId(el, 'tx-amount'), '1.234,50')
    expect(el.textContent).toContain('+US$\u00a01.234,50')
    await submit()
    expect(calls.find(c => c.url === '/api/cash')!.body).toMatchObject({ type: 'DEPOSITO', amount: 1234.5 })
    unmount()
  })

  it('cash: a plain "10" still works', async () => {
    const { el, calls, submit, unmount } = await openForm({ option: 'Caja en dólares' })
    setValue(byId(el, 'tx-amount'), '10')
    await submit()
    expect(calls.find(c => c.url === '/api/cash')!.body).toMatchObject({ amount: 10 })
    unmount()
  })
})
