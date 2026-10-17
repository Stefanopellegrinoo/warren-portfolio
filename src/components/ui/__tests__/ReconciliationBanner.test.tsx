import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ReconciliationBanner from '../ReconciliationBanner'

describe('ReconciliationBanner', () => {
  it('renders nothing while loading, on fetch failure, or when reconciled', () => {
    expect(renderToStaticMarkup(<ReconciliationBanner result={null} />)).toBe('')
    expect(renderToStaticMarkup(<ReconciliationBanner result={{ ok: true, reasons: [] }} />)).toBe('')
  })

  it('shows an amber banner with the reasons inside <details>', () => {
    const html = renderToStaticMarkup(
      <ReconciliationBanner result={{ ok: false, reasons: ['cash: 1.00 replayed vs 2.00 stored', 'ON ZZZ: quantity 1 replayed vs 2 stored'] }} />
    )
    expect(html).toContain('bg-amber')
    expect(html).toContain('<details')
    expect(html).toContain('2 diferencias')
    expect(html).toContain('Efectivo: tu historial da 1.00, lo guardado es 2.00')
    expect(html).toContain('ON ZZZ: cantidad según historial 1, guardada 2')
    expect(html).not.toContain('replayed')
  })

  it.each([
    ['stock AAA: quantity 10 replayed vs 12 stored', 'Acción AAA: cantidad según historial 10, guardada 12'],
    ['stock AAA: invested 50.0000 replayed vs 75.0000 stored', 'Acción AAA: invertido según historial 50.0000, guardado 75.0000'],
    ['ON ZZZ: replay holds 5 but the DB has no position', 'ON ZZZ: el historial indica 5 pero no hay posición guardada'],
    ['stock AAA: the DB holds 3 with no transactions behind it', 'Acción AAA: hay 3 guardadas sin operaciones que las respalden'],
  ])('translates %s', (reason, expected) => {
    expect(renderToStaticMarkup(<ReconciliationBanner result={{ ok: false, reasons: [reason] }} />)).toContain(expected)
  })

  it('shows an unrecognised reason in a generic Spanish line instead of raw English', () => {
    const html = renderToStaticMarkup(<ReconciliationBanner result={{ ok: false, reasons: ['stock X: non-numeric replayed quantity — refusing to reconcile'] }} />)
    expect(html).toContain('stock X: non-numeric')
    expect(html).toContain('No se pudo comparar')
  })

  it('uses the singular for one reason', () => {
    expect(renderToStaticMarkup(<ReconciliationBanner result={{ ok: false, reasons: ['cash: 1.00 replayed vs 2.00 stored'] }} />)).toContain('1 diferencia ')
  })
})
