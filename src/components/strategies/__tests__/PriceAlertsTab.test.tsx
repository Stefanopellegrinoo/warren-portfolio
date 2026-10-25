import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AlertsList, type PriceAlert } from '../PriceAlertsTab'

const alert = (over: Partial<PriceAlert>): PriceAlert => ({
  id: 'a1', ticker: 'AAPL', type: 'price', operator: 'crosses_above', value: 1234.5, name: 'AAPL arriba',
  status: 'active', created_at: '2026-10-01T12:00:00Z', triggered_at: null, ...over,
})

const render = (alerts: PriceAlert[]) =>
  renderToStaticMarkup(<AlertsList alerts={alerts} busyId={null} onDelete={() => {}} onRearm={() => {}} />)

describe('AlertsList', () => {
  it('offers Reactivar only on triggered alerts', () => {
    const html = render([
      alert({ id: 'a1', ticker: 'AAPL', status: 'active' }),
      alert({ id: 'a2', ticker: 'MSFT', status: 'triggered', triggered_at: '2026-10-20T15:00:00Z' }),
    ])
    expect(html.match(/>Reactivar</g)).toHaveLength(1)
    expect(html).toContain('aria-label="Reactivar la alerta de MSFT"')
    expect(html).not.toContain('aria-label="Reactivar la alerta de AAPL"')
  })

  it('shows the condition in Argentine format and the state as text', () => {
    const html = render([alert({ status: 'triggered', operator: 'crosses_below' })])
    expect(html).toContain('Baja de 1.234,50')
    expect(html).toContain('Disparada')
    expect(html).toContain('aria-label="Eliminar la alerta de AAPL"')
  })
})

// odd/tasks/chart-customization.md S6: the new conditions in words; one the server cannot check says so.
describe('AlertsList with conditions', () => {
  it('describes each new condition with its timeframe and way', () => {
    const html = render([
      alert({ id: 'a1', operator: 'crosses', value: null, source: 'price', target: 'ema50.ema50', timeframe: '1d', periods: { ema50: 50 } }),
      alert({ id: 'a2', ticker: 'FXI', operator: 'crosses_above', value: 70, source: 'rsi.rsi', target: 'value', timeframe: '1h', periods: { rsi: 14 } }),
      alert({ id: 'a3', ticker: 'GGAL', operator: 'crosses', value: 4.2, source: 'price', target: 'value' }),
    ])
    expect(html).toContain('Precio cruza EMA 50 (1D) · cualquiera')
    expect(html).toContain('RSI 14 cruza 70 (1h) · para arriba')
    expect(html).toContain('Precio cruza 4,20 · cualquiera')
  })

  it("shows \"No se puede revisar\" and offers Reactivar on an alert the server cannot check", () => {
    const html = render([alert({ status: 'unavailable', source: 'rsi.rsi', value: 70, timeframe: '1h', periods: { rsi: 14 } })])
    expect(html).toContain('No se puede revisar')
    expect(html).toContain('aria-label="Reactivar la alerta de AAPL"')
  })

  it("an alert from before, with none of the new fields, reads as it always did", () => {
    const html = render([alert({ operator: 'crosses_above', value: 195 })])
    expect(html).toContain('Supera 195,00')
    expect(html).toContain('Activa')
  })
})

// odd/tasks/push-notificaciones.md S2: the alerts tab says how an alert reaches the user.
describe('PriceAlertsTab', () => {
  it('says alerts are delivered to the devices with notifications on', async () => {
    const { PriceAlertsTab } = await import('../PriceAlertsTab')
    const html = renderToStaticMarkup(<PriceAlertsTab />)
    expect(html).toContain('Cuando se disparan te avisamos en los dispositivos donde activaste los avisos')
  })
})
