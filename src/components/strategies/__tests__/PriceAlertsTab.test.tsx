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

// odd/tasks/push-notificaciones.md S2: the alerts tab says how an alert reaches the user.
describe('PriceAlertsTab', () => {
  it('says alerts are delivered to the devices with notifications on', async () => {
    const { PriceAlertsTab } = await import('../PriceAlertsTab')
    const html = renderToStaticMarkup(<PriceAlertsTab />)
    expect(html).toContain('Cuando se disparan te avisamos en los dispositivos donde activaste los avisos')
  })
})
