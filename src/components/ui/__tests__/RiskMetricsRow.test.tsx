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
})
