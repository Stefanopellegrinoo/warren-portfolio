import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import HoldingsList from '../HoldingsList'
import HoldingsTable from '../HoldingsTable'
import { row, rows } from './fixtures'

const noop = () => {}

describe('HoldingsList', () => {
  const html = renderToStaticMarkup(<HoldingsList rows={rows} cash={19050.95} cashWeightPct={47.7} onAdjustCash={noop} />)

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
    const onlyStocks = renderToStaticMarkup(<HoldingsList rows={[row({})]} cash={0} cashWeightPct={0} onAdjustCash={noop} />)
    expect(onlyStocks).not.toContain('>CEDEARs')
  })

  it('links each ticker to its chart', () => {
    expect(html).toContain('href="/trading?symbol=DUK"')
  })

  it('shows signed results and the day change in es-AR', () => {
    expect(html).toContain('−37,1 %')
    expect(html).toContain('−0,5 % hoy')
    expect(html).toContain('4.827,00')
    expect(html).toContain('19.050,95')
  })

  it('marks positions without a price instead of showing zeros', () => {
    expect(html).toContain('Sin precio hoy')
    expect(html).not.toContain('NaN')
  })

  it('shows the quantity instead of repeating the ticker when the company name is unknown', () => {
    const unnamed = renderToStaticMarkup(<HoldingsList rows={[row({ ticker: 'SPG', name: null, quantityLabel: '20 acciones', weightPct: 10.3 })]} cash={0} cashWeightPct={0} onAdjustCash={noop} />)
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
      <HoldingsList rows={[...rows, row({ ticker: 'YMCJO', name: null, kind: 'on', quantityLabel: 'VN 1.500', href: '/ons/mi-cartera' })]} cash={0} cashWeightPct={0} onAdjustCash={noop} />,
    )
    expect(withOn).toContain('VN 1.500')
    expect(withOn).toContain('href="/ons/mi-cartera"')
    expect(withOn).not.toContain('No tenés ONs.')
  })
})

describe('HoldingsTable', () => {
  const html = renderToStaticMarkup(<HoldingsTable rows={rows} onSell={noop} />)

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

  it('names each sell button after its ticker', () => {
    expect(html).toContain('aria-label="Vender DUK"')
    expect(html).toContain('aria-label="Vender AAL"')
  })

  it('offers selling ONs too, as the old ON table did', () => {
    const on = renderToStaticMarkup(<HoldingsTable rows={[row({ ticker: 'YMCJO', kind: 'on', href: '/ons/mi-cartera' })]} onSell={noop} />)
    expect(on).toContain('aria-label="Vender YMCJO"')
  })
})
