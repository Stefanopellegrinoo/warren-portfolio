import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { forgetCached } from '@/lib/client-cache'
import OnPayments, { useOnPayments, type OnPaymentsData } from '../OnPayments'
import OnDetailLoader from '../OnDetailLoader'
import MyPortfolio from '../MyPortfolio'
import OnExplorer from '../OnExplorer'
import type { OnListRow } from '@/lib/on-analytics'

// odd/tasks/rendimiento.md S9: an ONs page seen before in the tab shows its last data at once, and a payment
// change shows the payments it answers with (one round trip). The heavy views are stand-ins: these tests read
// what reaches them.
vi.mock('../OnDetail', () => ({ default: ({ analysis }: { analysis: { row: { tickerO: string } } }) => <h1>{analysis.row.tickerO}</h1> }))
vi.mock('../MyPortfolioView', () => ({
  default: ({ data }: { data: { unmapped: { ticker: string }[] } }) => <p>Tenencias {data.unmapped.map((u) => u.ticker).join(',')}</p>,
  MyPortfolioFooter: () => null,
}))
vi.mock('next/navigation', () => ({ usePathname: () => '/ons', useSearchParams: () => new URLSearchParams() }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// A request left hanging would stay in flight for the next test (the cache shares in-flight loads): end it.
const hanging: (() => void)[] = []
afterEach(async () => {
  hanging.splice(0).forEach((end) => end())
  await new Promise((r) => setTimeout(r, 0))
  document.body.innerHTML = ''; vi.unstubAllGlobals(); forgetCached()
})

type Reply = { status: number; body?: unknown }
function stubFetch(routes: Record<string, Reply>, hang = false) {
  const fn = vi.fn(async (url: string, init?: { method?: string }) => {
    if (hang) await new Promise<void>((end) => { hanging.push(end) })
    const r = routes[`${init?.method ?? 'GET'} ${url}`]
    if (!r) throw new Error(`unexpected fetch ${init?.method ?? 'GET'} ${url}`)
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
async function mount(node: React.ReactNode) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  await act(async () => { createRoot(el).render(node) })
  await flush()
  return el
}
const button = (el: Element, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!
const gets = (fetch: ReturnType<typeof stubFetch>, url: string) => fetch.mock.calls.filter(([u, i]) => u === url && (i?.method ?? 'GET') === 'GET')

const PAYMENTS: OnPaymentsData = {
  payments: [{ ticker: 'MGCRD', date: '2026-05-14', kind: 'coupon', amount: 2363.75, corrected: true }],
  missing: [],
}
function Payments() {
  return <OnPayments state={useOnPayments()} />
}

describe('Pagos cobrados: a change shows the payments it answers with', () => {
  it('a correction shows the answered payments without asking for them again', async () => {
    const after = { payments: [{ ...PAYMENTS.payments[0], amount: 2000 }], missing: [] }
    const fetch = stubFetch({ 'GET /api/ons/pagos': { status: 200, body: PAYMENTS }, 'PUT /api/ons/pagos': { status: 200, body: { ok: true, ...after } } })
    const el = await mount(<Payments />)
    await act(async () => { button(el, 'Corregido por vos').click() })
    const amount = el.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(amount, '2.000')
      amount.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { el.querySelector('form')!.requestSubmit() })
    await flush()
    expect(el.querySelector('li[data-payment]')!.textContent).toContain('US$ 2.000,00')
    expect(gets(fetch, '/api/ons/pagos')).toHaveLength(1)
  })

  it('going back to automatic asks for the payments in the same request', async () => {
    const after = { payments: [{ ...PAYMENTS.payments[0], amount: 2400, corrected: false }], missing: [] }
    const revert = '/api/ons/pagos?ticker=MGCRD&pay_date=2026-05-14&kind=coupon&view=1'
    const fetch = stubFetch({ 'GET /api/ons/pagos': { status: 200, body: PAYMENTS }, [`DELETE ${revert}`]: { status: 200, body: after } })
    const el = await mount(<Payments />)
    await act(async () => { button(el, 'Corregido por vos').click() })
    await act(async () => { button(el, 'Volver al automático').click() })
    await flush()
    expect(el.querySelector('li[data-payment]')!.textContent).toContain('US$ 2.400,00')
    expect(el.querySelector('li[data-payment]')!.textContent).toContain('Corregir')
    expect(gets(fetch, '/api/ons/pagos')).toHaveLength(1)
  })
})

describe('ONs pages seen before show their last data at once', () => {
  it('an ON detail', async () => {
    const body = { analysis: { row: { tickerO: 'TSTAO' } }, history: [], asOf: null, stale: false, prices: { ok: true, fetchedAt: null } }
    stubFetch({ 'GET /api/ons/AR0000000001': { status: 200, body } })
    await mount(<OnDetailLoader isin="AR0000000001" />)
    stubFetch({}, true)
    const el = await mount(<OnDetailLoader isin="AR0000000001" />)
    expect(el.querySelector('h1')!.textContent).toBe('TSTAO')
  })

  it('my ONs, with their payments', async () => {
    const mine = { analysis: {}, unmapped: [{ ticker: 'ABCDD', vn: 100 }], asOf: null, stale: false }
    stubFetch({ 'GET /api/ons/mi-cartera': { status: 200, body: mine }, 'GET /api/ons/pagos': { status: 200, body: PAYMENTS } })
    await mount(<MyPortfolio />)
    stubFetch({}, true)
    const el = await mount(<MyPortfolio />)
    expect(el.textContent).toContain('Tenencias ABCDD')
    expect(el.textContent).toContain('MGCRD')
  })

  it('the ON explorer', async () => {
    const row = { isin: 'AR0000000001', tickerO: 'TSTAO', issuer: 'Emisor de Prueba', currencyLabel: 'USD MEP', law: 'NY', rateType: 'fixed', maturityDate: '2029-10-22', status: 'ok', price: 101.5, ytmPct: 6.09, adtvUsd: 1000, events: [], priceQuality: 'ok' } as unknown as OnListRow
    stubFetch({ 'GET /api/ons': { status: 200, body: { rows: [row], asOf: '2026-10-20', stale: false, prices: { ok: true, fetchedAt: null } } } })
    await mount(<OnExplorer />)
    stubFetch({}, true)
    const el = await mount(<OnExplorer />)
    expect(el.textContent).toContain('1 de 1 ONs')
  })
})
