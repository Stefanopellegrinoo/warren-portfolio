import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import OnExplorerFilters from '../OnExplorerFilters'
import { DEFAULT_STATE } from '@/lib/on-explorer-filters'

const render = (over = {}) =>
  renderToStaticMarkup(
    <OnExplorerFilters filters={{ ...DEFAULT_STATE.filters, ...over }} issuers={['Alfa S.A.', 'Beta S.A.']} currencies={['ARS', 'USD MEP']} onChange={vi.fn()} onReset={vi.fn()} />
  )

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

  it('reflects the current filter values', () => {
    const html = render({ q: 'cs50', ytmMin: 8, law: 'NY' })
    expect(html).toContain('value="cs50"')
    expect(html).toContain('value="8"')
    expect(html).toMatch(/<option value="NY" selected/)
  })

  it('gives the search box room for its placeholder', () => {
    expect(render()).toMatch(/id="on-q"[^>]*class="[^"]*min-w-\[/)
  })

  it('offers a reset only when a filter is active', () => {
    expect(render()).not.toContain('Limpiar filtros')
    expect(render({ law: 'ARG' })).toContain('Limpiar filtros')
  })
})
