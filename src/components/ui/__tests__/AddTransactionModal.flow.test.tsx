import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { toast } from 'sonner'
import AddTransactionModal from '../AddTransactionModal'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), info: vi.fn() } }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeAll(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.mocked(toast.success).mockClear(); document.body.innerHTML = '' })

type Call = { url: string; raw?: string }
function stubFetch(overrides: Record<string, () => Response> = {}) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, raw: init?.body ? String(init.body) : undefined })
    const override = Object.keys(overrides).find(k => url.startsWith(k))
    if (override) return overrides[override]()
    if (url === '/api/cedears') return new Response(JSON.stringify([{ ticker: 'AAPL', nombre: 'Apple', ratio: 20 }]))
    if (url === '/api/activos') return new Response('[]')
    if (url.startsWith('/api/fx?date=')) return new Response(JSON.stringify({ mep: { rate: 1500, date: '2026-10-20' }, ccl: { rate: 1600, date: '2026-10-20' } }))
    if (url === '/api/transactions') return new Response(JSON.stringify({ transaction: { id: 't' } }), { status: 201 })
    if (url === '/api/on-positions' || url === '/api/cash') return new Response('{}', { status: 201 })
    if (url.startsWith('/api/ons/search')) return new Response(JSON.stringify({ results: [{ ticker: 'YM42D', name: 'YPF 2042', source: 'byma' }] }))
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
const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find(b => b.textContent?.includes(text))
const DISCARD_QUESTION = 'Tenés datos sin guardar. ¿Descartarlos?'

type Initial = React.ComponentProps<typeof AddTransactionModal>['initialData']
async function open({ option, initialData, overrides }: { option?: string; initialData?: Initial; overrides?: Record<string, () => Response> } = {}) {
  const calls = stubFetch(overrides)
  const onClose = vi.fn()
  const onSuccess = vi.fn()
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<AddTransactionModal onClose={onClose} onSuccess={onSuccess} initialData={initialData} />) })
  await flush()
  if (option) { act(() => button(el, option)!.click()); await flush() }
  const submit = async () => {
    await act(async () => { el.querySelector('form')!.requestSubmit() })
    await flush()
  }
  return { el, calls, onClose, onSuccess, submit, dialog: el.querySelector('dialog')!, unmount: () => act(() => root.unmount()) }
}

async function pickCedear(el: HTMLElement) {
  setValue(byId(el, 'tx-date'), '2026-10-20')
  await flush()
  setValue(byId(el, 'tx-ticker'), 'AAP')
  act(() => button(el, 'Apple')!.click())
}

describe('AddTransactionModal — never loses typed data', () => {
  it('a pristine form closes at once from the X', async () => {
    const { el, onClose, unmount } = await open({ option: 'Caja en dólares' })
    act(() => el.querySelector<HTMLButtonElement>('button[aria-label="Cerrar"]')!.click())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(el.textContent).not.toContain(DISCARD_QUESTION)
    unmount()
  })

  it('with typed data, the X asks inside the modal; "Seguir editando" keeps the data', async () => {
    const { el, onClose, unmount } = await open({ option: 'Caja en dólares' })
    setValue(byId(el, 'tx-amount'), '1.000')
    act(() => el.querySelector<HTMLButtonElement>('button[aria-label="Cerrar"]')!.click())
    expect(onClose).not.toHaveBeenCalled()
    expect(el.textContent).toContain(DISCARD_QUESTION)
    act(() => button(el, 'Seguir editando')!.click())
    expect(el.textContent).not.toContain(DISCARD_QUESTION)
    expect(byId(el, 'tx-amount').value).toBe('1.000')
    expect(onClose).not.toHaveBeenCalled()
    unmount()
  })

  it('"Descartar" closes', async () => {
    const { el, onClose, unmount } = await open({ option: 'Caja en dólares' })
    setValue(byId(el, 'tx-description'), 'banco')
    act(() => el.querySelector<HTMLButtonElement>('button[aria-label="Cerrar"]')!.click())
    act(() => button(el, 'Descartar')!.click())
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('Escape (the dialog cancel) and a backdrop tap ask instead of closing a dirty form', async () => {
    const { el, dialog, onClose, unmount } = await open({ option: 'Caja en dólares' })
    setValue(byId(el, 'tx-amount'), '50')
    const cancel = new Event('cancel', { cancelable: true })
    act(() => { dialog.dispatchEvent(cancel) })
    expect(cancel.defaultPrevented).toBe(true)
    expect(el.textContent).toContain(DISCARD_QUESTION)
    act(() => button(el, 'Seguir editando')!.click())
    act(() => dialog.click())
    expect(el.textContent).toContain(DISCARD_QUESTION)
    expect(onClose).not.toHaveBeenCalled()
    unmount()
  })

  it('Escape on a pristine form still closes', async () => {
    const { dialog, onClose, unmount } = await open()
    act(() => { dialog.dispatchEvent(new Event('cancel', { cancelable: true })) })
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('an untouched quick sell closes at once', async () => {
    const { el, onClose, unmount } = await open({ initialData: { assetClass: 'ACCION', ticker: 'AAPL', quantity: 2.5, price: 190.7 } })
    act(() => el.querySelector<HTMLButtonElement>('button[aria-label="Cerrar"]')!.click())
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount()
  })
})

describe('AddTransactionModal — says what was saved', () => {
  it('CEDEAR buy', async () => {
    const { el, onSuccess, onClose, submit, unmount } = await open({ option: 'CEDEAR' })
    await pickCedear(el)
    setValue(byId(el, 'tx-quantity'), '10')
    setValue(byId(el, 'tx-price'), '16000')
    await submit()
    expect(toast.success).toHaveBeenCalledWith('Compra de 10 AAPL guardada')
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('stock quick sell', async () => {
    const { onSuccess, submit, unmount } = await open({ initialData: { assetClass: 'ACCION', ticker: 'MSFT', quantity: 5, price: 400 } })
    await submit()
    expect(toast.success).toHaveBeenCalledWith('Venta de 5 MSFT guardada')
    expect(onSuccess).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('cash deposit and withdrawal', async () => {
    const a = await open({ option: 'Caja en dólares' })
    setValue(byId(a.el, 'tx-amount'), '1.000')
    await a.submit()
    expect(toast.success).toHaveBeenLastCalledWith('Depósito de US$ 1.000,00 guardado')
    a.unmount()

    const b = await open({ option: 'Caja en dólares' })
    act(() => (b.el.querySelector('input[name="tx-cash"][value="RETIRO"]') as HTMLInputElement).click())
    setValue(byId(b.el, 'tx-amount'), '250,5')
    await b.submit()
    expect(toast.success).toHaveBeenLastCalledWith('Retiro de US$ 250,50 guardado')
    b.unmount()
  })

  it('ON buy, in nominal value', async () => {
    const { el, submit, unmount } = await open({ option: 'Obligación negociable' })
    setValue(byId(el, 'tx-ticker'), 'YM42')
    await act(async () => { await new Promise(r => setTimeout(r, 400)) })
    act(() => button(el, 'YPF 2042')!.click())
    setValue(byId(el, 'tx-quantity'), '10')
    setValue(byId(el, 'tx-price'), '98,5')
    await submit()
    expect(toast.success).toHaveBeenCalledWith('Compra de 1.000 VN de YM42D guardada')
    unmount()
  })

  it('no toast and no close when the server refuses', async () => {
    const { el, onSuccess, onClose, submit, unmount } = await open({
      option: 'Caja en dólares',
      overrides: { '/api/cash': () => new Response(JSON.stringify({ error: 'El monto supera tu saldo' }), { status: 400 }) },
    })
    setValue(byId(el, 'tx-amount'), '10')
    await submit()
    expect(toast.success).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(el.querySelector('[role="alert"]')?.textContent).toBe('El monto supera tu saldo')
    unmount()
  })
})

describe('AddTransactionModal — request bodies stay byte-for-byte the same', () => {
  it('CEDEAR buy', async () => {
    const { el, calls, submit, unmount } = await open({ option: 'CEDEAR' })
    await pickCedear(el)
    setValue(byId(el, 'tx-quantity'), '10')
    setValue(byId(el, 'tx-price'), '16000')
    await submit()
    expect(calls.find(c => c.url === '/api/transactions')!.raw).toBe(
      '{"date":"2026-10-20","ticker":"AAPL","operation":"COMPRA","assetType":"CEDEAR","tradeCurrency":"ARS","tradeQuantity":10,"tradePrice":16000,"tradeCommission":0,"notes":""}',
    )
    unmount()
  })

  it('stock quick sell', async () => {
    const { el, calls, submit, unmount } = await open({ initialData: { assetClass: 'ACCION', ticker: 'AAPL', quantity: 2.5, price: 190.7 } })
    setValue(byId(el, 'tx-date'), '2026-10-20')
    await submit()
    expect(calls.find(c => c.url === '/api/transactions')!.raw).toBe(
      '{"date":"2026-10-20","ticker":"AAPL","operation":"VENTA","quantity":2.5,"price":190.7,"commission":0,"notes":"","assetType":"ACCION","moneda":"USD"}',
    )
    unmount()
  })

  it('cash deposit', async () => {
    const { el, calls, submit, unmount } = await open({ option: 'Caja en dólares' })
    setValue(byId(el, 'tx-date'), '2026-10-20')
    setValue(byId(el, 'tx-amount'), '1.000')
    setValue(byId(el, 'tx-description'), 'banco')
    await submit()
    expect(calls.find(c => c.url === '/api/cash')!.raw).toBe('{"date":"2026-10-20","type":"DEPOSITO","amount":1000,"description":"banco"}')
    unmount()
  })

  it('ON buy', async () => {
    const { el, calls, submit, unmount } = await open({ option: 'Obligación negociable' })
    setValue(byId(el, 'tx-date'), '2026-10-20')
    setValue(byId(el, 'tx-ticker'), 'YM42')
    await act(async () => { await new Promise(r => setTimeout(r, 400)) })
    act(() => button(el, 'YPF 2042')!.click())
    setValue(byId(el, 'tx-quantity'), '10')
    setValue(byId(el, 'tx-price'), '98,5')
    await submit()
    expect(calls.find(c => c.url === '/api/on-positions')!.raw).toBe(
      '{"date":"2026-10-20","ticker":"YM42D","operation":"COMPRA","quantity":10,"price":98.5,"commission":0,"notes":""}',
    )
    unmount()
  })
})

describe('AddTransactionModal — errors point at the field', () => {
  it('a CEDEAR typed but not picked marks the ticker field and moves focus to it', async () => {
    const { el, calls, submit, unmount } = await open({ option: 'CEDEAR' })
    setValue(byId(el, 'tx-ticker'), 'ZZZ')
    setValue(byId(el, 'tx-quantity'), '10')
    setValue(byId(el, 'tx-price'), '100')
    await submit()
    expect(el.querySelector('[role="alert"]')?.textContent).toBe('Seleccioná un CEDEAR')
    expect(byId(el, 'tx-ticker').getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement?.id).toBe('tx-ticker')
    expect(calls.some(c => c.url === '/api/transactions')).toBe(false)
    setValue(byId(el, 'tx-ticker'), 'AAP')
    expect(byId(el, 'tx-ticker').hasAttribute('aria-invalid')).toBe(false)
    unmount()
  })

  it('a failed CEDEAR list says so and can be retried', async () => {
    let fail = true
    const { el, unmount } = await open({
      option: 'CEDEAR',
      overrides: { '/api/cedears': () => fail ? new Response('{}', { status: 500 }) : new Response(JSON.stringify([{ ticker: 'AAPL', nombre: 'Apple', ratio: 20 }])) },
    })
    expect(el.textContent).toContain('No se pudo cargar la lista de CEDEARs.')
    fail = false
    act(() => button(el, 'Reintentar')!.click())
    await flush()
    expect(el.textContent).not.toContain('No se pudo cargar la lista de CEDEARs.')
    setValue(byId(el, 'tx-ticker'), 'AAP')
    expect(button(el, 'Apple')).toBeTruthy()
    unmount()
  })

  it('a failed ON search says so instead of "No se encontraron ONs"', async () => {
    const { el, unmount } = await open({
      option: 'Obligación negociable',
      overrides: { '/api/ons/search': () => new Response('{}', { status: 500 }) },
    })
    setValue(byId(el, 'tx-ticker'), 'YM42')
    await act(async () => { await new Promise(r => setTimeout(r, 400)) })
    expect(el.textContent).toContain('No se pudo buscar')
    expect(el.textContent).not.toContain('No se encontraron ONs')
    unmount()
  })
})

describe('AddTransactionModal — default date', () => {
  it('is today in Argentina, not the UTC date (22:30 on the 23rd is still the 23rd)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-24T01:30:00Z'))
    const { el, unmount } = await open({ option: 'Caja en dólares' })
    expect(byId(el, 'tx-date').value).toBe('2026-10-23')
    unmount()
  })
})
