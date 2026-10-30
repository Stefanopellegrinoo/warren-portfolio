import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { METRICS } from '@/lib/fundamentals/catalog'
import type { AssetPage } from '@/lib/fundamentals/service'
import type { Metrics } from '@/lib/fundamentals/metrics'
import type { AssetStatements } from '@/lib/fundamentals/statements'
import type { Series } from '@/lib/fundamentals/types'
import { forgetCached } from '@/lib/client-cache'
import { NumerosTab } from '../NumerosTab'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Public company names only; every number is invented.
const at = (ends: string[], values: number[]): Series => ends.map((end, i) => ({ end, value: values[i] }))
const Q = ['2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30']
const Q32 = Array.from({ length: 32 }, (_, i) => new Date(Date.UTC(2018, 9 + i * 3, 0)).toISOString().slice(0, 10))
const YEARS = ['2022-12-31', '2023-12-31', '2024-12-31', '2025-12-31']

const STATEMENTS: AssetStatements = {
  yahoo: {
    currency: 'USD',
    quarterly: {
      revenue: at(Q, [6790e6, 7409e6, 8759e6, 8845e6, 10169e6]),
      netIncome: at(Q, [523e6, 421e6, 559e6, 417e6, 466e6]),
      sellingGeneralAndAdministration: at(Q, [1012e6, 1103e6, 1328e6, 1308e6, 1471e6]),
      dilutedEps: at(Q, [10.32, 8.3, 11.03, 8.23, 9.19]),
      totalAssets: at(Q, [32948e6, 36691e6, 42667e6, 46934e6, 51356e6]),
      stockholdersEquity: at(Q, [5e9, 5.5e9, 6e9, 6.2e9, 6.4e9]),
      operatingCashFlow: at(Q, [2.5e9, 2e9, 3.6e9, 1.6e9, 2.9e9]),
      capitalExpenditure: at(Q, [-3e8, -3.1e8, -3.2e8, -3.3e8, -3.4e8]),
      freeCashFlow: at(Q, [2.2e9, -1.21e8, 3.28e9, 1.27e9, 2.56e9]),
    },
    annual: { revenue: at(YEARS, [10.5e9, 14.5e9, 20.8e9, 28.9e9]), netIncome: at(YEARS, [4.8e8, 9.9e8, 1.9e9, 2e9]) },
  },
  tradingview: { currency: 'USD', quarterly: { revenue: at(Q32, Q32.map((_, i) => 355e6 + i * 300e6)) }, annual: {} },
  sources: { tradingview: 'ok', yahoo: 'ok', fx: 'ok' },
}

function page(): AssetPage {
  return {
    ticker: 'MELI', name: 'MercadoLibre, Inc.', exchange: 'NASDAQ', price: 1660, currency: 'USD', supported: true,
    listing: { ticker: 'MELI', market: 'america', tvSymbol: 'NASDAQ:MELI', yahooSymbol: 'MELI' },
    bymaListing: false,
    metrics: Object.fromEntries(METRICS.map((d) => [d.id, { id: d.id, today: 1, history: { quarterly: [], ttm: [], annual: [] }, since: null, asOf: null, source: 'yahoo' }])) as unknown as Metrics,
    peers: [],
    sources: { tradingview: 'ok', yahoo: 'ok' },
  }
}

let root: Root
let el: HTMLDivElement
let urls: string[]
const answer = (body: unknown, status = 200) => vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  urls.push(url)
  return Response.json(body, { status })
}))

async function render(path = '/activo/MELI', body: unknown = STATEMENTS, status = 200) {
  window.history.replaceState(null, '', path)
  answer(body, status)
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  await act(async () => root.render(<NumerosTab page={page()} />))
  await settle()
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

beforeEach(() => { urls = [] })
afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ''
  forgetCached()
  vi.unstubAllGlobals()
})

const text = (node: Element | null | undefined) => (node?.textContent ?? '').replace(/[\u00a0\u202f]/g, ' ')
const button = (label: RegExp) => [...el.querySelectorAll('button')].find((b) => label.test(b.getAttribute('aria-label') ?? b.textContent ?? ''))
const click = (node: Element | undefined | null) => act(() => { node!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const radio = (label: string) => [...el.querySelectorAll('input[type="radio"]')].find((i) => i.parentElement?.textContent === label)!
const table = () => el.querySelector('table')
const headers = () => [...table()!.querySelectorAll('thead th')].map((th) => text(th))
const row = (label: string) => [...table()!.querySelectorAll('tbody tr')].find((tr) => text(tr.querySelector('th')).startsWith(label))
const cells = (label: string) => [...row(label)!.querySelectorAll('td')].map((td) => text(td).trim())
const rowLabels = () => [...table()!.querySelectorAll('tbody th button[aria-label$=": ver su gráfico"]')].map((b) => b.getAttribute('aria-label')!.replace(': ver su gráfico', ''))

async function openBalances() {
  click(button(/^Ver balances completos/))
  await settle()
}

describe('Números → Balances completos', () => {
  it('ends Números with a link that opens the statements, kept in the URL; back returns to the list', async () => {
    await render()
    const entries = window.history.length
    const sections = el.querySelectorAll('section[aria-labelledby^="numeros-"]')
    expect(sections[sections.length - 1].compareDocumentPosition(button(/^Ver balances completos/)!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await openBalances()

    expect(window.location.search).toBe('?vista=balances')
    expect(window.history.length).toBe(entries + 1)
    expect(text(el.querySelector('h2'))).toBe('Balances completos de MercadoLibre')
    expect(urls).toEqual(['/api/asset/MELI/statements'])
    expect(el.querySelector('section[aria-labelledby^="numeros-"]')).toBeNull()

    await act(async () => {
      const back = new Promise((r) => window.addEventListener('popstate', r, { once: true }))
      button(/^Números$/)!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await back
    })
    expect(window.location.search).toBe('')
    expect(el.querySelectorAll('section[aria-labelledby^="numeros-"]').length).toBeGreaterThan(0)
    expect(document.activeElement).toBe(button(/^Ver balances completos/))
  })

  it('opens straight from the URL; there, its back replaces the URL instead of leaving the page', async () => {
    await render('/activo/MELI?tab=numeros&vista=balances')
    const entries = window.history.length
    expect(text(el.querySelector('h2'))).toBe('Balances completos de MercadoLibre')

    click(button(/^Números$/))

    expect(window.location.search).toBe('?tab=numeros')
    expect(window.history.length).toBe(entries)
    expect(button(/^Ver balances completos/)).toBeDefined()
  })
})

describe('Balances completos table', () => {
  beforeEach(() => render('/activo/MELI?vista=balances'))

  it('Resultados by quarter: a row per line, newest period first, US$ millions, ▲▼ against the same quarter a year earlier', () => {
    expect(headers()).toEqual(['US$ millones', 'abr–jun 2026', 'ene–mar 2026', 'oct–dic 2025', 'jul–sep 2025', 'abr–jun 2025'])
    expect(rowLabels()).toEqual(['Ventas', 'Gastos de venta y administración', 'Ganancia neta', 'Ganancia por acción (diluida)'])
    // 10.169 against 6.790 a year earlier; the first quarter has no year earlier.
    expect(cells('Ventas')).toEqual(['10.169▲ (sube)', '8.845', '8.759', '7.409', '6.790'])
    // 466 against 523: ▼, though above the 417 just before.
    expect(cells('Ganancia neta')[0]).toBe('466▼ (baja)')
    expect(cells('Ganancia por acción')[0]).toBe('US$ 9,19▼ (baja)')
  })

  it('keeps each "?" on the line of its label\'s last word, and a keyboard button per row opens its chart', async () => {
    const q = button(/^Qué es Gastos de venta y administración/)!
    expect(q.parentElement!.className).toContain('whitespace-nowrap')
    expect(text(q.parentElement)).toBe('administración?')

    click(button(/^Ventas: ver su gráfico/))
    await settle()
    expect(text(document.querySelector('[data-slot="dialog-content"] h2'))).toBe('Ventas')
  })

  it('scrolls sideways inside its own box, with the line names pinned', () => {
    const box = table()!.parentElement!
    expect(box.className).toContain('overflow-x-auto')
    // Positioned, so the cells' absolute sr-only words scroll with it instead of widening the page (seen at 390 px).
    expect(box.className).toMatch(/(^|\s)relative(\s|$)/)
    for (const th of [table()!.querySelector('thead th')!, ...table()!.querySelectorAll('tbody th')]) expect(th.className).toContain('sticky left-0')
  })

  it('shows negatives in red, with a minus sign', () => {
    click(radio('Flujo de caja'))
    const negative = [...row('Flujo de caja libre')!.querySelectorAll('td')].find((td) => text(td).includes('−121'))!
    expect(negative.className).toContain('text-danger')
    expect(text(row('Inversión (CapEx)')!.querySelector('td'))).toMatch(/^−340/)
  })

  it('Balance and Flujo de caja hold their own lines, and Anual one column per year', () => {
    click(radio('Balance'))
    expect(rowLabels()).toEqual(['Activos', 'Patrimonio'])
    click(radio('Flujo de caja'))
    expect(rowLabels()).toEqual(['Flujo de caja operativo', 'Inversión (CapEx)', 'Flujo de caja libre'])
    click(radio('Resultados'))
    click(radio('Anual'))
    expect(headers()).toEqual(['US$ millones', '2025', '2024', '2023', '2022'])
    expect(cells('Ventas')[0]).toBe('28.900▲ (sube)')
  })

  it("8 años: TradingView's lines come from TradingView over all their columns; Yahoo's rows say since when", () => {
    click(radio('8 años'))

    expect(headers()).toHaveLength(33)
    expect(headers().at(-1)).toBe('jul–sep 2018')
    expect(cells('Ventas').at(-1)).toBe('355')
    expect(cells('Ventas')[0]).toBe('9.655▲ (sube)')
    expect(text(row('Ganancia neta')!.querySelector('th'))).toContain('desde 2025')
    expect(text(el)).toContain('Ventas vienen de TradingView, desde 2018; el resto, de Yahoo Finance, desde 2025.')
  })

  it('says where the numbers come from, how far back and in what money', () => {
    expect(text(el)).toContain('Fuente: Yahoo Finance, desde 2025.')
    expect(text(el)).toContain('Montos en millones de dólares.')
  })

  it('a row opens its chart and its plain explanation; the "?" explains it on the spot', async () => {
    click(row('Ventas')!.querySelector('td'))
    await settle()
    const dialog = document.querySelector('[data-slot="dialog-content"]')!
    expect(text(dialog.querySelector('h2'))).toBe('Ventas')
    expect(dialog.querySelector('[role="img"]')!.getAttribute('aria-label')!.replace(/[\u00a0\u202f]/g, ' ')).toMatch(/^Ventas: de US\$ 6\.790 M en abr–jun 2025 a US\$ 10\.169 M en abr–jun 2026/)
    expect(text(dialog)).toContain('▲ 49,8 % contra un año antes')
    expect(text(dialog)).toContain('Todo lo que la empresa cobró por lo que vende en el período.')
    act(() => { (dialog.querySelector('button[aria-label="Cerrar"]') as HTMLElement).click() })
    await settle()
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull()

    click(button(/^Qué es Ganancia neta/))
    await settle()
    expect(text(document.querySelector('[data-slot="popover-content"]'))).toContain('Lo que le quedó después de pagar todo')
    // The "?" explains; it does not open the chart.
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull()
  })
})

describe('Balances completos states', () => {
  it("says so when a source failed, and retries", async () => {
    await render('/activo/MELI?vista=balances', { yahoo: null, tradingview: null, sources: { yahoo: 'error', tradingview: 'error' } })
    expect(text(el)).toContain('No pudimos traer los balances.')
    click(button(/^Reintentar/))
    await settle()
    expect(urls).toHaveLength(2)
  })

  it('a request failure is a retry, not a blank page', async () => {
    await render('/activo/MELI?vista=balances', { error: 'x' }, 500)
    expect(el.querySelector('[role="alert"]')).not.toBeNull()
    expect(button(/^Reintentar/)).toBeDefined()
  })

  it('without statements, says it has none', async () => {
    await render('/activo/MELI?vista=balances', { yahoo: null, tradingview: null, sources: {} })
    expect(text(el)).toContain('Todavía no tenemos balances de esta empresa.')
  })

  it("an Argentine reporter's year view explains why Yahoo has none, and converts at CCL", async () => {
    const ars: AssetStatements = { ...STATEMENTS, yahoo: { ...STATEMENTS.yahoo!, currency: 'ARS', annual: {} } }
    await render('/activo/MELI?vista=balances', ars)
    expect(text(el)).toContain('Montos en millones de dólares CCL, al cierre de cada período.')
    expect(text(el)).toContain('La ganancia por acción está en pesos, como la informa la empresa.')
    click(radio('Anual'))
    expect(table()).toBeNull()
    expect(text(el)).toContain('Yahoo no tiene balances anuales comparables de empresas que informan en pesos')
  })
})
