import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import OnExplorerTable from '../OnExplorerTable'
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
  bymaYtm: null,
  ...over,
})
const render = (rows: OnListRow[], sort: ExplorerState['sort'] = { key: 'maturity', dir: 'asc' }) =>
  renderToStaticMarkup(<OnExplorerTable rows={rows} sort={sort} onSort={vi.fn()} />)

describe('OnExplorerTable', () => {
  it('renders one row per ISIN linking to the detail, with formatted analytics', () => {
    const html = render([row()])
    expect(html).toContain('href="/ons/AR0000000001"')
    expect(html).toContain('TSTAO')
    expect(html).toContain('6,09%')
    expect(html).toContain('2,70')
    expect(html).toContain('USD 1,5 M')
    expect(html).toContain('22/04/2027')
    expect(html).toContain('+120 pb')
    expect(html.match(/<tbody>[\s\S]*<\/tbody>/)![0].match(/<tr/g)).toHaveLength(1)
  })

  it('shows "Sin precio" and dashes when there is no price, keeping terms visible', () => {
    const html = render([row({ status: 'no-price', price: null, ytmPct: null, mdYears: null, paridadPct: null, currentYieldPct: null, walYears: null, spreadBp: null })])
    expect(html).toContain('Sin precio')
    expect(html).toContain('2029')
    expect(html).not.toContain('6,09%')
  })

  it('floating-rate: "No simulable" with the reason, values as dashes', () => {
    const html = render([row({ rateType: 'floating', status: 'floating', simulable: false, price: null, ytmPct: null })])
    expect(html).toContain('No simulable')
    expect(html).toContain('title="Tasa variable: no se proyectan los cupones')
  })

  it('method check flag shows both values; a terms note is informational, not an error', () => {
    const flagged = render([row({ methodFlag: { bymaYtmPct: 6.2, methodYtmPct: 6.35, diffBp: 15, asOf: '2026-10-20' } })])
    // compact icon: sr-only text + tooltip carry both values, no inline paragraph
    expect(flagged).toContain('Cálculo no verificado')
    expect(flagged).toContain('BYMA 6,20%')
    expect(flagged).toContain('Warren 6,35%')
    expect(flagged).toContain('class="sr-only"')
    expect(flagged).not.toMatch(/<span class="block">/)
    const note = render([row({ termsNote: { bymaYtmPct: 6.0, termsYtmPct: 6.06, diffBp: 6, asOf: '2026-10-20' } })])
    expect(note).toContain('difiere de BYMA por convención')
    expect(note).not.toContain('Cálculo no verificado')
    expect(note).not.toContain('text-rose')
  })

  it('shows corporate-event badges with the date and source', () => {
    const html = render([row({ events: [{ kind: 'reapertura', eventDate: '2026-09-01', note: null, sourceUrl: 'https://example.org/e', verifiedAt: null }] })])
    expect(html).toContain('Reapertura')
    expect(html).toContain('01/09/2026')
    expect(html).toContain('href="https://example.org/e"')
  })

  it('warns that the yield of a short-dated bond is very sensitive to price', () => {
    // visible text (works on touch), not only a glyph/tooltip
    expect(render([row({ shortDated: true })])).toContain('&lt;90 d')
    expect(render([row()])).not.toContain('&lt;90 d')
  })

  it('keeps currency, law and rate type next to the ticker instead of far-right columns', () => {
    const html = render([row()])
    expect(html).not.toContain('>Moneda / ley<')
    expect(html).not.toContain('>Tipo<')
    const first = html.match(/<tbody>[\s\S]*?<\/td>/)![0]
    expect(first).toContain('USD MEP')
    expect(first).toContain('Tasa fija')
  })

  it('hints that the table scrolls horizontally', () => {
    expect(render([row()])).toContain('data-scroll-hint')
  })

  it('no-trades: visible tag, dimmed yield, sr-only text', () => {
    const html = render([row({ priceQuality: 'no-trades' })])
    expect(html).toContain('sin operaciones en la rueda')
    expect(html).toContain('text-[11px]')
    expect(html).not.toContain('opacity-50') // dimming must keep AA contrast
    expect(html).toContain('class="sr-only"')
    expect(render([row()])).not.toContain('sin operaciones en la rueda')
  })

  it('the TIR cell tooltip carries the BYMA yield for comparison', () => {
    const html = render([row({ bymaYtm: { pct: 8.41, asOf: '2026-10-20' } })])
    // visible secondary line, reachable on touch and keyboard (not only a title)
    expect(html).toContain('BYMA 8,41%')
    expect(html).toContain('20/10/2026')
  })

  it('empty list says "Sin resultados"', () => {
    expect(render([])).toContain('Sin resultados')
  })

  it('sortable headers announce the active sort', () => {
    const html = render([row()], { key: 'ytm', dir: 'desc' })
    expect(html).toContain('aria-sort="descending"')
    expect(html).toContain('<caption')
    expect(html.match(/aria-sort="none"/g)!.length).toBeGreaterThan(3)
  })
})
