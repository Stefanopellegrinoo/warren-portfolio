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
    expect(html).toContain('cash: 1.00 replayed vs 2.00 stored')
  })

  it('uses the singular for one reason', () => {
    expect(renderToStaticMarkup(<ReconciliationBanner result={{ ok: false, reasons: ['x'] }} />)).toContain('1 diferencia ')
  })
})
