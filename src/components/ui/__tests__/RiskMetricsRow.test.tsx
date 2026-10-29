import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import RiskMetricsRow from '../RiskMetricsRow'

describe('RiskMetricsRow', () => {
  it('writes the metrics in Argentine format with an explicit minus sign', () => {
    const html = renderToStaticMarkup(
      <RiskMetricsRow data={{ sharpeRatio: 1.234, annualizedVol: 0.1875, maxDrawdown: -0.123, returnIntervals: 120 }} />,
    )
    expect(html).toContain('1,23')
    expect(html).toContain('18,8 %')
    expect(html).toContain('−12,3 %')
  })

  it('says there is not enough data instead of showing a zero', () => {
    const html = renderToStaticMarkup(<RiskMetricsRow data={{ sharpeRatio: null, annualizedVol: null, maxDrawdown: null }} />)
    expect(html.match(/Sin datos suficientes/g)).toHaveLength(3)
  })

  it('states the scope as the whole portfolio, ONs included (S9)', () => {
    const html = renderToStaticMarkup(<RiskMetricsRow data={{ sharpeRatio: null, annualizedVol: null, maxDrawdown: null }} />)
    expect(html).toContain('Calculado sobre toda la cartera: acciones, ONs y caja.')
    expect(html).not.toContain('quedan afuera')
  })

  const none = { sharpeRatio: null, annualizedVol: null, maxDrawdown: null }
  const count = (html: string, text: string) => html.split(text).length - 1

  it('labels Sharpe as computed without a risk-free rate (S5)', () => {
    const html = renderToStaticMarkup(<RiskMetricsRow data={{ sharpeRatio: 0.8, annualizedVol: 0.2, maxDrawdown: -0.05, returnIntervals: 130 }} />)
    expect(html).toContain('sin tasa libre de riesgo')
  })

  it('below the minimum sample, volatility and Sharpe say how many days they need (S5)', () => {
    const html = renderToStaticMarkup(<RiskMetricsRow data={{ ...none, returnIntervals: 40 }} />)
    expect(html).toContain('Sin datos suficientes: necesita 60 días de mercado, hay 40')
    expect(html).toContain('Sin datos suficientes: necesita 126 días de mercado, hay 40')
  })

  it('states the measured period in Argentine format (S5)', () => {
    const html = renderToStaticMarkup(<RiskMetricsRow data={{ ...none, measuredFrom: '2026-04-08', measuredDays: 140 }} />)
    expect(html).toContain('Desde el 08/04/2026 · 140 días de mercado')
  })

  it('says how much deposit money was moved to the purchases it paid, and that the total does not change (S10)', () => {
    const html = renderToStaticMarkup(
      <RiskMetricsRow data={{ ...none, measuredFrom: '2022-02-09', measuredDays: 1150, fundedDeposits: { amount: 91311.74, from: '2022-02-09' } }} />,
    )
    expect(html).toContain('Algunos depósitos estaban cargados después de las compras que pagaron: para medir, US$ 91.311,74 se toman como depositados el día de esas compras, desde el 09/02/2022. El total depositado no cambia.')
  })

  it('says the days with negative cash were left out (S4)', () => {
    const html = renderToStaticMarkup(
      <RiskMetricsRow data={{ ...none, measuredFrom: '2026-04-08', measuredDays: 140, negativeCashUntil: '2026-04-07' }} />,
    )
    expect(html).toContain('Hasta el 07/04/2026 hay días con la caja negativa (faltan depósitos): quedan afuera.')
  })

  it('with negative cash today shows no number and says deposits are missing (S4)', () => {
    const html = renderToStaticMarkup(
      <RiskMetricsRow data={{ ...none, returnIntervals: 0, negativeCashUntil: '2026-10-28', unavailableReason: 'negative_cash' }} />,
    )
    expect(count(html, '>—<')).toBe(3)
    expect(count(html, 'Faltan depósitos')).toBe(4)
    expect(html).toContain('Faltan depósitos: la caja registrada hoy es negativa y toda la cartera no se puede medir.')
    expect(html).not.toContain('Sin datos suficientes')
    expect(html).not.toContain('Desde el')
  })

  it('discloses a degraded series in one line (S5)', () => {
    expect(renderToStaticMarkup(<RiskMetricsRow data={{ ...none, degraded: true }} />))
      .toContain('Faltan precios de algunos días: se valuaron al costo.')
    expect(renderToStaticMarkup(<RiskMetricsRow data={none} />)).not.toContain('Faltan precios')
  })

  it('discloses skipped intervals on volatility and Sharpe, as on the drawdown (S5)', () => {
    const html = renderToStaticMarkup(
      <RiskMetricsRow data={{ sharpeRatio: 0.8, annualizedVol: 0.2, maxDrawdown: -0.05, returnIntervals: 130, drawdownIntervalsSkipped: 2 }} />,
    )
    expect(count(html, '2 intervalos omitidos')).toBe(3)
  })
})
