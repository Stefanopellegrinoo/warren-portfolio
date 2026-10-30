import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import HoldingsList from '../HoldingsList'
import HoldingsTable from '../HoldingsTable'
import { DEFAULT_SORT } from '@/lib/resumen/holdings'
import { row, rows } from './fixtures'

const noop = () => {}

describe('HoldingsList', () => {
  const html = renderToStaticMarkup(<HoldingsList rows={rows} cash={19050.95} cashWeightPct={47.7} onAdjustCash={noop} sort={DEFAULT_SORT} onSort={noop} />)

  it('groups holdings by asset type: stocks, CEDEARs, ONs, then cash', () => {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    const order = ['Acciones 2', 'CEDEARs 1', 'Obligaciones negociables', 'Caja'].map(h => text.indexOf(h))
    expect(order.every(i => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(html).not.toContain('Acciones y CEDEARs')
  })

  it('lists each holding under its own type', () => {
    const cedears = html.slice(html.indexOf('>CEDEARs'), html.indexOf('>Obligaciones negociables'))
    expect(cedears).toContain('>AAL<')
    expect(cedears).not.toContain('>DUK<')
  })

  it('omits a type group the portfolio does not hold', () => {
    const onlyStocks = renderToStaticMarkup(<HoldingsList rows={[row({})]} cash={0} cashWeightPct={0} onAdjustCash={noop} sort={DEFAULT_SORT} onSort={noop} />)
    expect(onlyStocks).not.toContain('>CEDEARs')
  })

  it('links each ticker to its chart', () => {
    expect(html).toContain('href="/trading?symbol=DUK"')
  })

  // odd/tasks/asset-page.md S1: a separate link opens the asset page; the ticker keeps opening the chart.
  it('adds a link to each stock and CEDEAR asset page, keeping the ticker on the chart', () => {
    expect(html).toMatch(/<a[^>]*href="\/trading\?symbol=DUK"[^>]*>DUK<\/a>/)
    expect(html).toMatch(/<a(?=[^>]*aria-label="Ficha de DUK")(?=[^>]*href="\/activo\/DUK")[^>]*>Ficha<\/a>/)
    expect(html).toMatch(/href="\/activo\/AAL"/)
    const withOn = renderToStaticMarkup(
      <HoldingsList rows={[row({ ticker: 'YMCJO', name: null, kind: 'on', quantityLabel: 'VN 1.500', href: '/ons/mi-cartera' })]} cash={0} cashWeightPct={0} onAdjustCash={noop} sort={DEFAULT_SORT} onSort={noop} />,
    )
    expect(withOn).not.toContain('/activo/')
  })

  it('shows signed results and the day change in es-AR', () => {
    expect(html).toContain('−37,1 %')
    expect(html).toContain('−0,5 %<span class="sr-only"> hoy</span>')
    expect(html.replace(/<span class="sr-only">[^<]*<\/span>/g, '')).not.toMatch(/% hoy/)
    expect(html).toContain('4.827,00')
    expect(html).toContain('19.050,95')
  })

  it('marks positions without a price instead of showing zeros', () => {
    expect(html).toContain('>Sin precio<')
    expect(html).not.toContain('Sin precio hoy')
    expect(html).not.toContain('NaN')
  })

  it('shows the quantity instead of repeating the ticker when the company name is unknown', () => {
    const unnamed = renderToStaticMarkup(<HoldingsList rows={[row({ ticker: 'SPG', name: null, quantityLabel: '20 acciones', weightPct: 10.3 })]} cash={0} cashWeightPct={0} onAdjustCash={noop} sort={DEFAULT_SORT} onSort={noop} />)
    expect(unnamed).toMatch(/font-medium">20 acciones</)
    expect(unnamed).toContain('10,3 % de la cartera')
    expect(unnamed).not.toMatch(/font-medium">SPG</)
  })

  it('invites to explore ONs when there are none', () => {
    expect(html).toContain('No tenés ONs.')
    expect(html).toMatch(/href="\/ons"/)
  })

  it('lists ONs in their own group linking to the ON portfolio', () => {
    const withOn = renderToStaticMarkup(
      <HoldingsList rows={[...rows, row({ ticker: 'YMCJO', name: null, kind: 'on', quantityLabel: 'VN 1.500', href: '/ons/mi-cartera' })]} cash={0} cashWeightPct={0} onAdjustCash={noop} sort={DEFAULT_SORT} onSort={noop} />,
    )
    expect(withOn).toContain('VN 1.500')
    expect(withOn).toContain('href="/ons/mi-cartera"')
    expect(withOn).not.toContain('No tenés ONs.')
  })
})

describe('HoldingsList sorting', () => {
  it('offers sorting by every column, marking the active one', () => {
    const html = renderToStaticMarkup(<HoldingsList rows={rows} cash={0} cashWeightPct={0} onAdjustCash={noop} sort={{ key: 'pnl', dir: 'asc' }} onSort={noop} />)
    for (const label of ['Activo', 'Hoy', 'Valor', 'Resultado', 'Peso']) expect(html).toMatch(new RegExp(`<button[^>]*>${label}`))
    expect(html).toMatch(/aria-pressed="true"[^>]*>Resultado/)
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
  })

  it('orders each group by the chosen column', () => {
    const two = [row({ ticker: 'HIGH', pnl: 400 }), row({ ticker: 'LOW', pnl: -50 })]
    const html = renderToStaticMarkup(<HoldingsList rows={two} cash={0} cashWeightPct={0} onAdjustCash={noop} sort={{ key: 'pnl', dir: 'asc' }} onSort={noop} />)
    expect(html.indexOf('>LOW<')).toBeLessThan(html.indexOf('>HIGH<'))
  })

  it('asks for the next sort when a column is tapped', async () => {
    const { createRoot } = await import('react-dom/client')
    const { act } = await import('react-dom/test-utils')
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const chosen: unknown[] = []
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    act(() => root.render(<HoldingsList rows={rows} cash={0} cashWeightPct={0} onAdjustCash={noop} sort={DEFAULT_SORT} onSort={s => chosen.push(s)} />))
    act(() => [...el.querySelectorAll('button')].find(b => b.textContent?.startsWith('Hoy'))!.click())
    act(() => [...el.querySelectorAll('button')].find(b => b.textContent?.startsWith('Valor'))!.click())
    expect(chosen).toEqual([{ key: 'dayChangePct', dir: 'desc' }, { key: 'value', dir: 'asc' }])
    act(() => root.unmount())
    el.remove()
  })
})

describe('HoldingsTable', () => {
  const html = renderToStaticMarkup(<HoldingsTable rows={rows} onSell={noop} sort={DEFAULT_SORT} onSort={noop} />)

  it('makes every sortable header a button inside a th with aria-sort', () => {
    const headers = html.match(/<th[^>]*aria-sort="[^"]+"[^>]*><button/g) ?? []
    expect(headers.length).toBeGreaterThanOrEqual(5)
    expect(html).toContain('aria-sort="descending"')
  })

  it('keeps the columns of the old positions table', () => {
    for (const h of ['Cantidad', 'Precio', 'Costo prom.', 'Invertido', 'Valor', 'Hoy', 'Resultado', 'Peso']) expect(html).toContain(`>${h}<`)
    expect(html).toContain('95,00')
    expect(html).toContain('3.800,00')
  })

  it('keeps holdings apart by asset type, with a header row per group', () => {
    const groups = [...html.matchAll(/<th[^>]*scope="rowgroup"[^>]*>(.*?)<\/th>/g)].map(m => m[1].replace(/<[^>]+>/g, '').trim())
    expect(groups).toEqual(['Acciones', 'CEDEARs'])
    const cedears = html.slice(html.indexOf('scope="rowgroup"', html.indexOf('>Acciones')) )
    expect(cedears).toContain('>AAL<')
    expect(cedears).not.toContain('>DUK<')
  })

  it('orders each group by the chosen column', () => {
    const two = [row({ ticker: 'LOW', pnlPct: -0.2 }), row({ ticker: 'HIGH', pnlPct: 0.4 })]
    const byPnl = renderToStaticMarkup(<HoldingsTable rows={two} onSell={noop} sort={{ key: 'pnlPct', dir: 'desc' }} onSort={noop} />)
    expect(byPnl.indexOf('>HIGH<')).toBeLessThan(byPnl.indexOf('>LOW<'))
    expect(byPnl).toMatch(/aria-sort="descending"[^>]*><button[^>]*>Resultado %/)
  })

  it('names each sell button after its ticker', () => {
    expect(html).toContain('aria-label="Vender DUK"')
    expect(html).toContain('aria-label="Vender AAL"')
  })

  it('offers selling ONs too, as the old ON table did', () => {
    const on = renderToStaticMarkup(<HoldingsTable rows={[row({ ticker: 'YMCJO', kind: 'on', href: '/ons/mi-cartera' })]} onSell={noop} sort={DEFAULT_SORT} onSort={noop} />)
    expect(on).toContain('aria-label="Vender YMCJO"')
  })
})
