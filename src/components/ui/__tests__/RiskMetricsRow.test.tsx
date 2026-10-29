import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import RiskMetricsRow, { degradedMessages } from '../RiskMetricsRow'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

  it('a degraded series is one quiet line with an (i), not a warning (S5, S11)', () => {
    const html = renderToStaticMarkup(<RiskMetricsRow data={{ ...none, degraded: true, degradedReasons: [{ kind: 'today_unpriced', tickers: ['NVDA'] }] }} />)
    expect(html).toContain('Algunos precios no estuvieron disponibles')
    expect(html).toContain('aria-label="Qué precios faltaron"')
    expect(html).not.toContain('se valuaron al costo')
    expect(html).not.toMatch(/text-warn[^>]*>Algunos precios/)
    expect(renderToStaticMarkup(<RiskMetricsRow data={none} />)).not.toContain('Algunos precios')
  })

  it('says each missing price in words that match its cause, per asset (S11)', () => {
    expect(degradedMessages([
      { kind: 'today_unpriced', tickers: ['NVDA', 'BCBA:GGAL'] },
      { kind: 'no_bars', tickers: ['XYZ'] },
      { kind: 'stale_bars', tickers: ['SPY', 'QQQ', 'AAPL'] },
      { kind: 'splits_unknown', tickers: ['NU'] },
      { kind: 'ccl_missing', tickers: ['BCBA:YPFD', 'BCBA:PAMP'] },
      { kind: 'on_prices' }, { kind: 'on_schedules' }, { kind: 'failure' },
    ])).toEqual([
      'Hoy no hay cotización en vivo de NVDA y GGAL: se usa su último cierre.',
      'No hay historial de precios de XYZ: se valúa a su precio de compra.',
      'Yahoo no respondió para SPY, QQQ y AAPL: se usan los últimos precios guardados.',
      'Yahoo no informó los splits de NU: se usan los que tiene la app.',
      'Faltan cotizaciones del CCL de algunos días: YPFD y PAMP mantienen su precio anterior esos días.',
      'No se pudieron leer los cierres de las ONs: se valúan a su precio de compra.',
      'No se pudo leer el cronograma de pagos de las ONs: faltan sus cupones y amortizaciones automáticos.',
      'Un dato no se pudo leer y la historia quedó incompleta.',
    ])
    // An answer cached before the reasons existed still says something true.
    expect(degradedMessages(undefined)).toEqual(['Faltó algún precio y se usó un valor de reemplazo.'])
  })

  it('pressing the (i) shows what happened: a tap on a phone, as a hover does on a computer (S11)', async () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => { root.render(<RiskMetricsRow data={{ ...none, degraded: true, degradedReasons: [{ kind: 'today_unpriced', tickers: ['NVDA'] }] }} />) })
    expect(document.body.textContent).not.toContain('Hoy no hay cotización en vivo')
    const button = el.querySelector<HTMLButtonElement>('button[aria-label="Qué precios faltaron"]')!
    await act(async () => { button.click() })
    expect(document.body.textContent).toContain('Hoy no hay cotización en vivo de NVDA: se usa su último cierre.')
    act(() => root.unmount())
    el.remove()
  })

  it('discloses skipped intervals on volatility and Sharpe, as on the drawdown (S5)', () => {
    const html = renderToStaticMarkup(
      <RiskMetricsRow data={{ sharpeRatio: 0.8, annualizedVol: 0.2, maxDrawdown: -0.05, returnIntervals: 130, drawdownIntervalsSkipped: 2 }} />,
    )
    expect(count(html, '2 intervalos omitidos')).toBe(3)
  })
})
