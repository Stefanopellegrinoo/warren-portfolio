import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DetailedStats, { type StatData } from '../DetailedStats'

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
})
