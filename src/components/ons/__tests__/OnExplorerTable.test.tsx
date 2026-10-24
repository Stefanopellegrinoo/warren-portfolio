import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import OnExplorerTable, { SortSelect } from '../OnExplorerTable'
import type { OnListRow } from '@/lib/on-analytics'
import type { ExplorerState } from '@/lib/on-explorer-filters'

const row = (over: Partial<OnListRow> = {}): OnListRow => ({
  isin: 'AR0000000001',
  tickerO: 'TSTAO',
  tickerD: 'TSTAD',
  issuer: 'Emisor de Prueba',
  description: null,
  currency: 'USD',
  currencyLabel: 'USD MEP',
  plaza: 'MEP',
  law: 'NY',
  rateType: 'fixed',
  maturityDate: '2029-10-22',
  status: 'ok',
  simulable: true,
  price: 101.5,
  ytmPct: 6.09,
  mdYears: 2.7,
  paridadPct: 101.2,
  currentYieldPct: 5.9,
  walYears: 3,
  spreadBp: 120,
  adtvUsd: 1_500_000,
  nextPayDate: '2027-04-22',
  nextPayAmountPct: 3,
  methodFlag: null,
  termsNote: null,
  events: [],
  shortDated: false,
  priceQuality: 'ok',
  priceLine: 'D',
  lineFallback: false,
  cclUsed: null,
  bymaYtm: null,
  ...over,
})
const render = (rows: OnListRow[], sort: ExplorerState['sort'] = { key: 'maturity', dir: 'asc' }, moreColumns = false) =>
  renderToStaticMarkup(<OnExplorerTable rows={rows} sort={sort} onSort={vi.fn()} moreColumns={moreColumns} />)
const table = (html: string) => html.match(/<table[\s\S]*<\/table>/)![0]
const card = (html: string) => html.match(/<ul aria-label="Obligaciones negociables"[\s\S]*?<\/ul>/)![0]
const heads = (html: string) => [...table(html).matchAll(/<th scope="col"[^>]*>(?:<button[^>]*>|<span[^>]*>)([^<]+)/g)].map((m) => m[1])

describe('OnExplorerTable', () => {
  it('renders one row per ISIN linking to the detail, with the default columns', () => {
    const html = render([row()])
    expect(html).toContain('href="/ons/AR0000000001"')
    expect(html).toContain('TSTAO')
    expect(html).toContain('6,09%')
    expect(html).toContain('101,50')
    expect(html).toContain('USD 1,5 M')
    expect(html).toContain('22/04/2027')
    expect(html).toContain('22/10/2029')
    expect(html.match(/<tbody>[\s\S]*<\/tbody>/)![0].match(/<tr/g)).toHaveLength(1)
  })

  // S4: the columns a retail investor chooses by; the rest with "Más columnas".
  it('defaults to ON, maturity, price, TIR, next payment and volume; "Más columnas" adds the technical ones', () => {
    const def = render([row()])
    expect(heads(def)).toEqual(['ON', 'Vence', 'Precio', 'TIR', 'Próximo pago', 'Volumen'])
    expect(table(def)).not.toContain('+120 pb')
    expect(table(def)).not.toContain('2,70')
    expect(def).not.toContain('data-scroll-hint')
    const more = render([row()], undefined, true)
    expect(heads(more)).toEqual(['ON', 'Vence', 'Precio', 'TIR', 'Próximo pago', 'Volumen', 'Duración', 'Paridad', 'Tasa corriente', 'Vida promedio', 'Spread'])
    expect(table(more)).toContain('+120 pb')
    expect(table(more)).toContain('2,70')
    expect(table(more)).toContain('101,20%')
    expect(more).toContain('data-scroll-hint')
  })

  // S4: one TIR per bond; the BYMA TIR lives on the detail page.
  it('shows one TIR per row, never the BYMA one', () => {
    const html = render([row({ bymaYtm: { pct: 8.41, asOf: '2026-10-20' } })])
    expect(html).not.toContain('8,41')
    expect(html).not.toContain('BYMA 8')
    const tirCell = table(html).match(/<td[^>]*><span class="flex flex-col[\s\S]*?<\/td>/)![0]
    expect(tirCell.match(/%/g)).toHaveLength(1)
    expect(card(html).match(/6,09%/g)).toHaveLength(1)
  })

  it('shows "Sin precio" and dashes when there is no price, keeping terms visible', () => {
    const html = render([row({ status: 'no-price', price: null, ytmPct: null, mdYears: null, paridadPct: null, currentYieldPct: null, walYears: null, spreadBp: null })])
    expect(html).toContain('Sin precio')
    expect(html).toContain('2029')
    expect(html).not.toContain('6,09%')
  })

  // S6: no explanation lives only in a title= tooltip.
  it('says why a TIR is missing or needs care in visible words, not glyphs or tooltips', () => {
    const floating = render([row({ rateType: 'floating', status: 'floating', simulable: false, price: null, ytmPct: null })])
    expect(floating).toContain('tasa variable')
    const flagged = render([row({ methodFlag: { bymaYtmPct: 6.2, methodYtmPct: 6.35, diffBp: 15, asOf: '2026-10-20' } })])
    expect(flagged).toContain('difiere de BYMA')
    expect(flagged).not.toContain('⚠')
    const short = render([row({ shortDated: true })])
    expect(short).toContain('vence en menos de 90 días')
    expect(short).not.toContain('&lt;90 d')
    // the convention note is informational: it stays on the detail page
    expect(render([row({ termsNote: { bymaYtmPct: 6.0, termsYtmPct: 6.06, diffBp: 6, asOf: '2026-10-20' } })])).not.toContain('ⓘ')
    for (const html of [floating, flagged, short]) expect(html).not.toContain('title=')
    expect(render([row()])).not.toContain('vence en menos de 90 días')
  })

  it('no-trades rows show the TIR as a dash and say why (the value stays on the detail page)', () => {
    const html = render([row({ priceQuality: 'no-trades', ytmPct: -14.96 })])
    expect(html).not.toContain('14,96')
    expect(html).toContain('sin operaciones en la rueda')
    expect(html).toContain('text-warn')
    expect(render([row()])).not.toContain('sin operaciones en la rueda')
  })

  it('shows at most one tag per ON: its first corporate event, with the date and source', () => {
    const html = render([row({ events: [
      { kind: 'reapertura', eventDate: '2026-09-01', note: null, sourceUrl: 'https://example.org/e', verifiedAt: null },
      { kind: 'canje', eventDate: '2026-10-01', note: null, sourceUrl: 'https://example.org/c', verifiedAt: null },
    ] })])
    expect(html).toContain('Reapertura 01/09/2026')
    expect(html).toContain('href="https://example.org/e"')
    expect(html).not.toContain('Canje')
  })

  it('keeps the issuer and currency next to the ticker; law, rate type and ISIN live on the detail page', () => {
    const first = table(render([row()])).match(/<tbody>[\s\S]*?<\/th>/)![0]
    expect(first).toContain('Emisor de Prueba')
    expect(first).toContain('USD MEP')
    expect(first).not.toContain('Tasa fija')
    expect(first).not.toContain('AR0000000001<')
  })

  it('empty list says "Sin resultados"', () => {
    expect(render([])).toContain('Sin resultados')
  })

  it('sortable headers announce the active sort', () => {
    const html = render([row()], { key: 'ytm', dir: 'desc' })
    expect(html).toContain('aria-sort="descending"')
    expect(html).toContain('<caption')
    expect(html.match(/aria-sort="none"/g)!.length).toBe(4)
  })

  // S4: on phones the card shows whatever the list is sorted by.
  it('the phone card shows Vence, Precio, next payment and the value of the sort key when it is not already there', () => {
    const byVolume = card(render([row()], { key: 'adtv', dir: 'desc' }))
    expect(byVolume).toContain('href="/ons/AR0000000001"')
    expect(byVolume).toContain('6,09%')
    expect(byVolume).toContain('Vence 22/10/2029')
    expect(byVolume).toContain('Precio 101,50')
    expect(byVolume).toContain('Próximo pago 22/04/2027')
    expect(byVolume).toContain('Volumen USD 1,5 M')
    expect(card(render([row()], { key: 'md', dir: 'desc' }))).toContain('Duración 2,70')
    expect(card(render([row()], { key: 'spread', dir: 'asc' }))).toContain('Spread +120 pb')
    const byTir = card(render([row()], { key: 'ytm', dir: 'desc' }))
    expect(byTir).not.toContain('Volumen')
    expect(byTir).not.toContain('Duración')
  })

  it('the phone sort control is labelled and says the current order in words', () => {
    const html = renderToStaticMarkup(<SortSelect sort={{ key: 'adtv', dir: 'desc' }} onSort={vi.fn()} />)
    expect(html).toMatch(/<label[^>]*for="on-sort"[^>]*>Ordenar por</)
    expect(html).toMatch(/<option value="adtv:desc" selected="">Volumen, mayor primero</)
    const byMaturity = renderToStaticMarkup(<SortSelect sort={{ key: 'maturity', dir: 'asc' }} onSort={vi.fn()} />)
    expect(byMaturity).toMatch(/<option value="maturity:asc" selected="">Vencimiento, más cercano primero</)
  })
})
