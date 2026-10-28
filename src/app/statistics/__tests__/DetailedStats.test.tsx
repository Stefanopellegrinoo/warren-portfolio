import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DetailedStats, { largestResults, type StatData } from '../DetailedStats'
import { CumulativeChart, MonthlyChart } from '../DetailedCharts'

// Recharts draws nothing without a measured size; this stand-in prints what the
// axis tick and the tooltip label would show for each point of a chart (its X dataKey).
vi.mock('recharts', async () => {
  const { createContext, useContext } = await import('react')
  type Point = Record<string, string>
  const Points = createContext<{ points: Point[]; key: string }>({ points: [], key: 'date' })
  const Chart = ({ data, children }: { data: Point[]; children: React.ReactNode }) =>
    <Points.Provider value={{ points: data, key: 'date' }}>{children}</Points.Provider>
  const none = () => null
  const Axis = ({ dataKey = 'date', tickFormatter }: { dataKey?: string; tickFormatter: (v: string) => string }) => {
    const { points } = useContext(Points)
    return <>{points.map(p => <i key={p[dataKey]}>tick {tickFormatter(p[dataKey])};</i>)}</>
  }
  const Tip = ({ labelFormatter = () => '' }: { labelFormatter?: (v: string) => string }) => {
    const { points } = useContext(Points)
    return <>{points.map(p => <b key={p.date ?? p.month}>label {labelFormatter(p.date ?? p.month)};</b>)}</>
  }
  return {
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    LineChart: Chart, BarChart: Chart, YAxis: none, CartesianGrid: none, Line: none, Bar: none, Cell: none,
    XAxis: Axis, Tooltip: Tip,
  }
})

const data: StatData = {
  maxDrawdown: -0.123, winRate: null, totalPortfolioValue: 10000,
  allocation: [{ name: 'DUK', value: 6000, pct: 0.6 }, { name: 'SPG', value: 4000, pct: 0.4 }],
  realizedPnl: 100, openPnl: -300,
  biggestWinner: { ticker: 'DUK', pnl: 250, pnl_pct: 0.1, status: 'OPEN' },
  biggestLoser: { ticker: 'SPG', pnl: -150.5, pnl_pct: -0.05, status: 'CLOSED' },
  allPnLs: [], monthlyReturns: [], cumulativePnl: [],
  avgHoldingDays: 30, maxHoldingDays: 60, minHoldingDays: 2, avgWin: 200, avgLoss: -100,
  profitFactor: 2, sharpeRatio: 0.5, annualizedVol: 0.2, monthlyStdDev: null,
  winnersCount: 0, losersCount: 0, totalTrades: 0, arsExposure: 2500, usdExposure: 7500,
}

describe('DetailedStats', () => {
  it('shows results with their sign, not only their color', () => {
    const html = renderToStaticMarkup(<DetailedStats data={data} assetLabel="Acciones" />)
    expect(html).toContain('−200,00') // total = 100 − 300
    expect(html).toContain('+250,00')
    expect(html).toContain('−150,50')
  })

  it('shows a dash, not 0 %, when there are no closed trades', () => {
    const html = renderToStaticMarkup(<DetailedStats data={data} assetLabel="Acciones" />)
    expect(html).toMatch(/Tasa de acierto<\/dt><dd[^>]*>—</)
  })

  it('writes shares in Argentine format', () => {
    const html = renderToStaticMarkup(<DetailedStats data={{ ...data, universe: 'stocks' }} assetLabel="Acciones" />)
    expect(html).toContain('60,0 %')
    expect(html).toContain('US$ 7.500,00')
  })

  // The chart loads on its own (odd/tasks/rendimiento.md S9), so its drawing is read from its module.
  it('shows a close date as that day, not the previous one in Argentina, with its year (S4, S7)', () => {
    const html = renderToStaticMarkup(<CumulativeChart data={[{ date: '2026-10-24', ticker: 'DUK', pnl: 50, cumulative: 50 }]} />)
    expect(html).toContain('tick 24/10/26;')
    expect(html).toContain('label 24/10/2026;')
  })

  it('names each month with its year (S7)', () => {
    const html = renderToStaticMarkup(<MonthlyChart data={[{ month: '2025-12', pnl: 0, trades: 0 }, { month: '2026-01', pnl: 5, trades: 1 }]} />)
    expect(html).toContain('tick Dic 2025;')
    expect(html).toContain('tick Ene 2026;')
    expect(html).toContain('label Ene 2026;')
  })
})

/** The figure a KpiCard shows right after its label. */
const figure = (html: string, label: string) =>
  html.match(new RegExp(`${label.replace(/[()]/g, '\\$&')}</dt><dd[^>]*>([^<]*)<`))?.[1]
/** The markup of one section, by the id of its heading. */
const section = (html: string, id: string) =>
  html.match(new RegExp(`<section aria-labelledby="${id}"[^>]*>(.*?)</section>`, 's'))?.[1] ?? ''

describe('DetailedStats — every figure says what it measures (S7)', () => {
  const sales = { ...data, winRate: 0.5, winnersCount: 1, losersCount: 1, totalTrades: 2 }

  it('says the realized result includes the dividends, never that they are outside it', () => {
    const html = renderToStaticMarkup(<DetailedStats data={{ ...data, universe: 'stocks', incomeReceived: 30 }} assetLabel="acciones" />)
    expect(figure(html, 'Dividendos cobrados')).toBe('+30,00')
    expect(html).toContain('Incluidos en el resultado realizado')
    expect(html).not.toContain('No forma parte')
  })

  it('calls the ONs\' income coupons, also inside the realized result', () => {
    const html = renderToStaticMarkup(<DetailedStats data={{ ...data, incomeReceived: 12 }} assetLabel="ONs" />)
    expect(figure(html, 'Cupones cobrados')).toBe('+12,00')
    expect(html).toContain('Incluidos en el resultado realizado')
  })

  it('counts sales, not closed operations', () => {
    const html = renderToStaticMarkup(<DetailedStats data={sales} assetLabel="acciones" />)
    expect(html).toContain('1 ganadoras y 1 perdedoras de 2 ventas')
    expect(figure(html, 'Cantidad de ventas')).toBe('2')
    expect(html).not.toMatch(/operaciones cerradas/i)
    expect(renderToStaticMarkup(<DetailedStats data={data} assetLabel="acciones" />)).toContain('Sin ventas todavía')
  })

  it('keeps the sales figures out of "Riesgo"', () => {
    const html = renderToStaticMarkup(<DetailedStats data={sales} assetLabel="acciones" />)
    expect(section(html, 'h-riesgo-detalle')).not.toContain('Factor de beneficio')
    expect(section(html, 'h-riesgo-detalle')).not.toContain('Tenencia promedio')
    expect(section(html, 'h-ventas')).toContain('Factor de beneficio')
    expect(section(html, 'h-ventas')).toContain('Tenencia promedio')
  })

  it('says holding days run from the first purchase, and shows a dash — never 0 — with nothing to measure', () => {
    const none = { ...data, avgHoldingDays: null, minHoldingDays: null, maxHoldingDays: null, avgWin: null, avgLoss: null }
    const html = renderToStaticMarkup(<DetailedStats data={none} assetLabel="acciones" />)
    expect(figure(html, 'Tenencia promedio')).toBe('—')
    expect(html).toContain('Desde la primera compra de la posición')
    expect(html).not.toContain('0 días')
    expect(figure(html, 'Ganancia promedio')).toBe('—')
    expect(figure(html, 'Pérdida promedio')).toBe('—')
    expect(renderToStaticMarkup(<DetailedStats data={data} assetLabel="acciones" />)).toContain('mínima 2 días · máxima 60 días')
  })

  it('discloses the positions without a quote and what they are valued at', () => {
    const stocks = { ...data, universe: 'stocks', unpricedPositions: 2, unpricedTickers: ['VIST', 'AAPL'] }
    expect(renderToStaticMarkup(<DetailedStats data={stocks} assetLabel="acciones" />))
      .toContain('2 posiciones sin cotización (VIST, AAPL): valuadas al costo, sin resultado abierto.')
    // An ON without a quote is marked at its last close, at cost only without one.
    expect(renderToStaticMarkup(<DetailedStats data={{ ...data, unpricedPositions: 1, unpricedTickers: ['ONA'] }} assetLabel="ONs" />))
      .toContain('1 posición sin cotización (ONA): valuada a su último cierre o, si no lo hay, al costo.')
    expect(renderToStaticMarkup(<DetailedStats data={data} assetLabel="acciones" />)).not.toContain('sin cotización')
  })

  it('splits the stocks by market and shows no market split on the ONs tab', () => {
    const stocks = renderToStaticMarkup(<DetailedStats data={{ ...data, universe: 'stocks' }} assetLabel="acciones" />)
    expect(section(stocks, 'h-mercado')).toContain('Mercado local (BCBA)')
    expect(stocks).not.toContain('Exposición por moneda')
    const ons = renderToStaticMarkup(<DetailedStats data={data} assetLabel="ONs" />)
    expect(ons).not.toContain('mercados internacionales')
    expect(ons).not.toContain('h-mercado')
  })

  it('says best and worst mix open positions and sales, and shows no worst when nothing lost', () => {
    const html = renderToStaticMarkup(<DetailedStats data={{ ...data, biggestLoser: null }} assetLabel="acciones" />)
    expect(figure(html, 'Mejor operación (abierta o venta)')).toBe('+250,00')
    expect(html).toContain('DUK (+10,00 %) · posición abierta')
    expect(figure(html, 'Peor operación (abierta o venta)')).toBe('—')
    expect(html).toContain('Ninguna con pérdida')
    expect(renderToStaticMarkup(<DetailedStats data={data} assetLabel="acciones" />)).toContain('SPG (−5,00 %) · venta')
  })

  it('charts the assets of largest result, gains or losses, best first', () => {
    const rows = [...Array.from({ length: 20 }, (_, i) => ({ ticker: `G${i}`, pnl: i + 1 })), { ticker: 'L', pnl: -100 }]

    const top = largestResults(rows, 15)

    expect(top).toHaveLength(15)
    expect(top[0]).toEqual({ ticker: 'G19', pnl: 20 })
    expect(top[top.length - 1]).toEqual({ ticker: 'L', pnl: -100 })
    expect(top.map(r => r.pnl)).not.toContain(6)
  })

  it('describes the per-asset chart as one bar per asset that keeps the losses', () => {
    const html = renderToStaticMarkup(<DetailedStats data={data} assetLabel="acciones" />)
    expect(section(html, 'h-por-activo')).toContain('Una barra por activo')
    expect(section(html, 'h-por-activo')).toContain('ganancias o pérdidas')
  })
})
