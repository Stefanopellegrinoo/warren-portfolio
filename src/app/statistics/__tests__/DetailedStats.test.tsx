import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DetailedStats, { type StatData } from '../DetailedStats'
import { CumulativeChart } from '../DetailedCharts'

// Recharts draws nothing without a measured size; this stand-in prints what the
// axis tick and the tooltip label would show for each point of the line chart.
vi.mock('recharts', async () => {
  const { createContext, useContext } = await import('react')
  type Point = { date: string }
  const Points = createContext<Point[]>([])
  const Chart = ({ data, children }: { data: Point[]; children: React.ReactNode }) => <Points.Provider value={data}>{children}</Points.Provider>
  const none = () => null
  return {
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    LineChart: Chart, BarChart: Chart, YAxis: none, CartesianGrid: none, Line: none, Bar: none, Cell: none,
    XAxis: ({ tickFormatter }: { tickFormatter: (v: string) => string }) =>
      <>{useContext(Points).map(p => <i key={p.date}>tick {tickFormatter(p.date)};</i>)}</>,
    Tooltip: ({ labelFormatter = () => '' }: { labelFormatter?: (v: string) => string }) =>
      <>{useContext(Points).map(p => <b key={p.date}>label {labelFormatter(p.date)};</b>)}</>,
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
    const html = renderToStaticMarkup(<DetailedStats data={data} assetLabel="Acciones" />)
    expect(html).toContain('60,0 %')
    expect(html).toContain('US$ 7.500,00')
  })

  // The chart loads on its own (odd/tasks/rendimiento.md S9), so its drawing is read from its module.
  it('shows a close date as that day, not the previous one in Argentina (S4)', () => {
    const html = renderToStaticMarkup(<CumulativeChart data={[{ date: '2026-10-24', ticker: 'DUK', pnl: 50, cumulative: 50 }]} />)
    expect(html).toContain('tick 24/10;')
    expect(html).toContain('label 24/10/2026;')
  })
})
