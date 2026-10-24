import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import SummaryHeader from '../SummaryHeader'
import ValueSection from '../ValueSection'
import HoldingsList from '../HoldingsList'
import HoldingsTable from '../HoldingsTable'
import { DEFAULT_SORT } from '@/lib/resumen/holdings'
import { row } from './fixtures'

const noop = () => {}
const header = { marketOpen: false, autoRefresh: false, onRefreshDue: noop, onToggleRefresh: noop, onImport: noop, onNew: noop }

describe('currency selector in the Resumen header', () => {
  it('offers the three currencies as a named radio group, with the current one checked', () => {
    const html = renderToStaticMarkup(<SummaryHeader {...header} currency="MEP" onCurrency={noop} />)
    expect(html).toContain('aria-label="Moneda de los montos"')
    expect(html.match(/type="radio" name="resumen-currency"/g)).toHaveLength(3)
    expect(html).toMatch(/checked="" value="MEP"/)
    expect(html.match(/checked=""/g)).toHaveLength(1)
    for (const label of ['Pesos', 'Dólar MEP', 'Dólar cable']) expect(html).toContain(label)
  })

  it("shows today's MEP and CCL in pesos when the summary carries them", () => {
    const text = renderToStaticMarkup(<SummaryHeader {...header} fx={{ mep: 1550.25, ccl: 1638.7 }} />).replace(/<[^>]+>/g, '')
    expect(text).toContain('Dólar MEP $ 1.550,25 · CCL $ 1.638,70')
  })

  it('is not shown when the summary has no views (unchanged header)', () => {
    expect(renderToStaticMarkup(<SummaryHeader {...header} />)).not.toContain('resumen-currency')
  })
})

describe('ValueSection figures', () => {
  const figures = {
    prefix: '$', total: 2_440_000, dayPnl: 30_000, dayPnlPct: 0.0375, openPnl: -1500, openPnlPct: -0.01,
    realized: 12_500, realizedLabel: 'Realizado, con dividendos y cupones', capital: 960_000,
  }

  it('shows every figure in the chosen currency with its label', () => {
    const html = renderToStaticMarkup(<ValueSection figures={figures} />)
    expect(html).toContain('$ 2.440.000,00')
    expect(html.replace(/<[^>]+>/g, '')).toContain('+30.000,00 (+3,75 %)')
    expect(html).not.toContain('por precio')
    expect(html).toMatch(/<span class="sr-only">hoy<\/span>/)
    expect(html).toContain('−1.500,00')
    expect(html).toContain('Realizado, con dividendos y cupones')
    expect(html).toContain('+12.500,00')
    expect(html).toContain('960.000,00')
    expect(html).not.toContain('Por qué los resultados cambian')
  })

  it('without views: the USD headline as before', () => {
    const html = renderToStaticMarkup(<ValueSection figures={{ ...figures, prefix: 'US$', total: 1600 , realizedLabel: 'Resultado realizado' }} />)
    expect(html).toContain('US$ 1.600,00')
    expect(html).toContain('Resultado realizado')
    expect(html).not.toContain('por precio')
  })
})

describe('estimado labels and the cash note', () => {
  const rows = [row({}), row({ ticker: 'DIS', name: 'Disney', estimated: true, value: 480_000 })]

  it('the list labels estimated values and explains the cash balance', () => {
    const html = renderToStaticMarkup(<HoldingsList rows={rows} cash={160_000} cashWeightPct={6.6} cashNote="Se registra en dólar MEP" onAdjustCash={noop} sort={DEFAULT_SORT} onSort={noop} />)
    expect(html.match(/>estimado</g)).toHaveLength(1)
    expect(html.replace(/<[^>]+>/g, '')).toContain('6,6 % de la cartera. Se registra en dólar MEP')
    expect(html).toContain('160.000,00')
  })

  it('the table labels estimated values', () => {
    const html = renderToStaticMarkup(<HoldingsTable rows={rows} onSell={noop} sort={DEFAULT_SORT} onSort={noop} />)
    expect(html.match(/>estimado</g)).toHaveLength(1)
  })

  it('no note, no label: the list as before', () => {
    const html = renderToStaticMarkup(<HoldingsList rows={[row({})]} cash={100} cashWeightPct={2} onAdjustCash={noop} sort={DEFAULT_SORT} onSort={noop} />)
    expect(html).toContain('2,0 % de la cartera</span>')
    expect(html).not.toContain('estimado')
  })
})
