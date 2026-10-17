import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PriceAge from '../PriceAge'

const now = new Date('2026-10-14T15:00:00Z') // Wed 12:00 AR, market open

describe('PriceAge', () => {
  it('renders nothing for a fresh price', () => {
    expect(renderToStaticMarkup(<PriceAge asOf="2026-10-14T14:55:00Z" now={now} />)).toBe('')
  })

  it('renders an amber dot with the as-of time in the tooltip for a stale price', () => {
    const html = renderToStaticMarkup(<PriceAge asOf="2026-10-14T10:00:00Z" now={now} />)
    expect(html).toContain('bg-amber')
    expect(html).toContain('title="Precio desactualizado')
    expect(html).toContain('14/10/2026')
  })

  it('says the time is unknown when there is no as-of', () => {
    const html = renderToStaticMarkup(<PriceAge asOf={undefined} now={now} />)
    expect(html).toContain('sin hora de actualización')
  })
})
