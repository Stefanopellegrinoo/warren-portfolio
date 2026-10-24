import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import OnExplorerFilters from '../OnExplorerFilters'
import { DEFAULT_STATE, type ExplorerFilters } from '@/lib/on-explorer-filters'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { document.body.innerHTML = '' })

const props = (over: Partial<ExplorerFilters> = {}, onChange = vi.fn()) => ({
  filters: { ...DEFAULT_STATE.filters, ...over }, issuers: ['Alfa S.A.', 'Beta S.A.'], currencies: ['ARS', 'USD MEP'],
  today: '2026-10-24', resultCount: 12, onChange, onReset: vi.fn(),
})
const render = (over: Partial<ExplorerFilters> = {}) => renderToStaticMarkup(<OnExplorerFilters {...props(over)} />)
const filtersButton = (html: string) => html.match(/<button[^>]*aria-controls="on-filters"[\s\S]*?<\/button>/)![0].replace(/<[^>]+>/g, '')

describe('OnExplorerFilters', () => {
  it('labels every control for assistive tech', () => {
    const html = render()
    for (const label of ['Buscar', 'Emisor', 'Moneda', 'Ley', 'Tipo de tasa', 'Vence desde', 'Vence hasta', 'TIR mín. (%)', 'TIR máx. (%)', 'Duración mín.', 'Duración máx.']) {
      expect(html).toContain(label)
    }
    expect(html.match(/<label/g)!.length).toBeGreaterThanOrEqual(11)
  })

  it('offers the catalog issuers and currencies', () => {
    const html = render()
    expect(html).toContain('Alfa S.A.')
    expect(html).toContain('USD MEP')
  })

  it('reflects the current filter values, numbers the Argentine way', () => {
    const html = render({ q: 'cs50', ytmMin: 8.5, law: 'NY' })
    expect(html).toContain('value="cs50"')
    expect(html).toContain('value="8,5"')
    expect(html).toMatch(/<option value="NY" selected/)
  })

  // S4: search is always visible; the other filters are behind one control.
  it('keeps the search visible while the other filters are closed', () => {
    const html = render()
    const panel = html.match(/<form id="on-filters"[^>]*>[\s\S]*<\/form>/)![0]
    expect(panel).toMatch(/^<form[^>]*hidden=""/)
    expect(panel).not.toContain('id="on-q"')
    expect(html).toMatch(/<input[^>]*id="on-q"[^>]*type="search"/)
    expect(html).toContain('aria-expanded="false"')
  })

  it('the "Filtros" control shows how many filters are set, the search not counted', () => {
    expect(filtersButton(render())).toBe('Filtros')
    expect(filtersButton(render({ q: 'ypf' }))).toBe('Filtros')
    expect(filtersButton(render({ law: 'NY', ytmMin: 8 }))).toBe('Filtros · 2 activos')
  })

  it('offers "Limpiar" only when a filter or the search is set', () => {
    expect(render()).not.toContain('Limpiar')
    expect(render({ law: 'ARG' })).toContain('Limpiar')
    expect(render({ q: 'ypf' })).toContain('Limpiar')
  })

  it('shows the presets as toggles, pressed when their filter is set', () => {
    const html = render({ law: 'NY' })
    expect(html).toMatch(/aria-pressed="true"[^>]*>(<svg[\s\S]*?<\/svg>)?Ley Nueva York</)
    expect(html).toMatch(/aria-pressed="false"[^>]*>Pagan en dólar MEP</)
    expect(html).toMatch(/aria-pressed="false"[^>]*>Vencen en 2 años o menos</)
  })

  it('a number filter reads "8,5" as 8.5, as every number field of the app', () => {
    const onChange = vi.fn()
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    act(() => root.render(<OnExplorerFilters {...props({}, onChange)} />))
    const input = el.querySelector<HTMLInputElement>('#on-ytm-min')!
    expect(input.type).toBe('text')
    expect(input.inputMode).toBe('decimal')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => { setter.call(input, '8,5'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(onChange).toHaveBeenLastCalledWith({ ytmMin: 8.5 })
    act(() => root.unmount())
  })
})
