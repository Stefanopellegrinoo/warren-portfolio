import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import PortfolioBuilder from '../portfolios/PortfolioBuilder'
import { analyzePortfolio, type PortfolioItem } from '@/lib/on-portfolio-analytics'
import { analyzeOn } from '@/lib/on-analytics'

// odd/tasks/ux-ons-y-operaciones.md S5, through the real component with the network stubbed.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals() })

const on = (isin: string, over: Record<string, unknown>, flows: { date: string; ren: number; amo: number }[], price: number | null) =>
  analyzeOn({
    terms: { isin, tickerO: 'TSTO', tickerD: 'TSTD', tickerC: null, issuer: 'Emisor de Prueba S.A.', description: null, law: 'NY', currency: 'USD', paymentPlaza: 'CCL', est: 'Step Up', frequency: 'Semestral', issueDate: '2026-04-22', maturityDate: '2028-04-21', couponRate: 0.06, residualPct: 100, accrualStart: '2026-10-22', issuedAmountByma: null, adtvO: null, adtvD: null, adtvC: null, asOf: '2026-10-20', ...over } as any,
    flows, overrides: [], events: [], check: null, curve: [], price, settle: '2026-10-22',
  })
const A = on('AR0000000001', { tickerO: 'AAAAO', tickerD: 'AAAAD' }, [{ date: '2027-04-22', ren: 3, amo: 0 }, { date: '2028-04-21', ren: 3, amo: 100 }], 100)
const B = on('AR0000000002', { tickerO: 'BBBBO', tickerD: 'BBBBD', issuer: 'Otra Emisora S.A.' }, [{ date: '2027-01-15', ren: 4, amo: 100 }], 100)
const ID = '11111111-1111-4111-8111-111111111111'
const ITEM_A = { id: 'item-a', isin: 'AR0000000001', mode: 'vn' as const, amount: 10_000, manualPrice: null }
const ITEM_B = { id: 'item-b', isin: 'AR0000000002', mode: 'usd' as const, amount: 1_000, manualPrice: null }

const view = (items: (PortfolioItem & { id: string })[]) => ({
  portfolio: { id: ID, name: 'Ingreso mensual' },
  items,
  analysis: analyzePortfolio({ items, analyses: [A, B], today: '2026-10-21' }),
  asOf: '2026-10-20', stale: false, prices: { ok: true, fetchedAt: null }, limits: { portfolios: 10, items: 20 },
})

type Reply = { status: number; body?: unknown }
type Handler = (url: string, method: string) => Reply | undefined
function stubFetch(handler: Handler, items = [ITEM_A]) {
  const fn = vi.fn(async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET'
    const r = handler(url, method)
      ?? (url === '/api/ons' ? { status: 200, body: { rows: [A.row, B.row] } } : { status: 200, body: view(items) })
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body }
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
async function mount() {
  // jsdom has no ResizeObserver; the calendar chart (recharts) asks for one even inside a closed section.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  const el = document.createElement('div')
  document.body.appendChild(el)
  await act(async () => { createRoot(el).render(<PortfolioBuilder id={ID} />) })
  await flush()
  return el
}
const button = (el: Element, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!
const click = async (b: HTMLElement) => { await act(async () => { b.click() }); await flush() }
function type(el: Element, selector: string, value: string) {
  const input = el.querySelector(selector) as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
const alerts = (el: Element) => [...el.querySelectorAll('[role="alert"]')]

describe('PortfolioBuilder (S5)', () => {
  it('shows the result summary first, then its ONs, then the add form, with the full analysis collapsed', async () => {
    stubFetch(() => undefined)
    const el = await mount()
    const text = el.textContent!
    const order = ['Total a cobrar', 'ONs de la cartera', 'Agregar una ON', 'Calendario de cobros'].map((s) => text.indexOf(s))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    const details = [...el.querySelectorAll('details')]
    expect(details.map((d) => d.id)).toEqual(['pf-calendar', 'pf-annual', 'pf-ladder', 'pf-issuers', 'pf-plaza', 'pf-positions', 'glosario'])
    expect(details.some((d) => d.open)).toBe(false)
  })

  it('shows the same ticker as the explorer (the O line)', async () => {
    stubFetch(() => undefined)
    const el = await mount()
    const list = el.querySelector('ul[aria-label="ONs de la cartera"]')!.textContent
    expect(list).toContain('AAAAO')
    expect(list).not.toContain('AAAAD')
  })

  it('an empty portfolio starts with the add form and a one-line explanation', async () => {
    stubFetch(() => undefined, [])
    const el = await mount()
    expect(el.querySelector('section')!.getAttribute('aria-labelledby')).toBe('pf-add')
    expect(el.textContent).toContain('Agregá la primera ON')
    expect(el.textContent).toContain('poné cuánto comprarías')
    expect(el.textContent).not.toContain('Total a cobrar')
  })

  it('renaming sits behind a button and its error shows under the name field', async () => {
    stubFetch((url, method) => (method === 'PATCH' ? { status: 400, body: { error: 'El nombre puede tener hasta 60 caracteres' } } : undefined))
    const el = await mount()
    expect(el.querySelector('#pf-name')).toBeNull()
    await click(button(el, 'Renombrar'))
    type(el, '#pf-name', 'Otro nombre')
    await click(button(el, 'Guardar'))
    const [alert] = alerts(el)
    expect(alerts(el)).toHaveLength(1)
    expect(alert.textContent).toBe('El nombre puede tener hasta 60 caracteres')
    expect(el.querySelector('header')!.contains(alert)).toBe(true)
  })

  it('an add error shows under the add form, not at the top of the page', async () => {
    stubFetch((url, method) => (method === 'POST' ? { status: 422, body: { error: 'Mínimo: VN 1.000' } } : undefined))
    const el = await mount()
    type(el, '#pf-search', 'bbbb')
    await click([...el.querySelectorAll('ul[aria-label="Resultados de la búsqueda"] button')].find((b) => b.textContent?.includes('BBBBO')) as HTMLElement)
    type(el, '#add-amount', '50')
    await click(button(el, 'Agregar a la cartera'))
    expect(alerts(el)).toHaveLength(1)
    expect(alerts(el)[0].textContent).toBe('Con ese monto no llegás a la compra mínima de esta ON: VN 1.000 (la lámina mínima).')
    expect(el.querySelector('section[aria-labelledby="pf-add"]')!.contains(alerts(el)[0])).toBe(true)
  })

  it('a successful add says so and the result is reloaded', async () => {
    let added = false
    const fetch = stubFetch((url, method) => {
      if (method === 'POST') { added = true; return { status: 201, body: { item: ITEM_B } } }
      if (url.startsWith('/api/test-portfolios/') && added) return { status: 200, body: view([ITEM_A, ITEM_B]) }
    })
    const el = await mount()
    type(el, '#pf-search', 'BBBBO')
    await click([...el.querySelectorAll('ul[aria-label="Resultados de la búsqueda"] button')][0] as HTMLElement)
    type(el, '#add-amount', '1.000')
    await click(button(el, 'Agregar a la cartera'))
    expect(el.querySelector('[role="status"]')?.textContent).toContain('Agregaste BBBBO')
    expect(el.querySelector('ul[aria-label="ONs de la cartera"]')!.textContent).toContain('BBBBO')
    expect(fetch.mock.calls.filter(([u, i]) => u === `/api/test-portfolios/${ID}` && i?.method === 'GET')).toHaveLength(2)
  })

  it('an edit error shows under the ON being edited', async () => {
    stubFetch((url, method) => (method === 'PATCH' ? { status: 422, body: { error: 'Por debajo de la lámina mínima' } } : undefined))
    const el = await mount()
    await click(button(el, 'Editar'))
    type(el, '#edit-item-a-amount', '5')
    await click(button(el, 'Guardar'))
    expect(alerts(el)).toHaveLength(1)
    expect(alerts(el)[0].textContent).toBe('Por debajo de la lámina mínima')
    expect(alerts(el)[0].closest('li')!.textContent).toContain('AAAAO')
  })

  it('a failed removal says so on the ON\'s row', async () => {
    stubFetch((url, method) => (method === 'DELETE' ? { status: 500, body: { error: 'No se pudo quitar la ON' } } : undefined))
    const el = await mount()
    await click(button(el, 'Quitar'))
    await click(button(el, 'Sí, quitar'))
    expect(alerts(el)).toHaveLength(1)
    expect(alerts(el)[0].closest('li')!.textContent).toContain('AAAAO')
  })

  it('a failed catalog load says so and offers a retry instead of loading forever', async () => {
    let calls = 0
    stubFetch((url) => (url === '/api/ons' && calls++ === 0 ? { status: 500, body: { error: 'No se pudo cargar el catálogo de ONs' } } : undefined))
    const el = await mount()
    expect(el.textContent).not.toContain('Cargando catálogo')
    const [alert] = alerts(el)
    expect(alert.textContent).toContain('No se pudo cargar el catálogo de ONs')
    expect(el.querySelector('#pf-search')).toBeNull()
    await click(button(alert, 'Reintentar'))
    expect(alerts(el)).toHaveLength(0)
    expect(el.querySelector('#pf-search-count')!.textContent).toContain('ONs en dólares disponibles')
  })
})
